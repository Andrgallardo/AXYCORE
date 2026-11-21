import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { evaluateCreditDecisionV2, DEFAULT_POLICY_V2 } from './src/engine/decisionEngineV2';
import { generateAmortizationSchedule } from './src/engine/amortizationEngine';
import {
  extractBcrdExchangeRate,
  type BcrdExchangeRateResult,
} from './src/engine/loanCalculatorEngine';
import {
  canUserExecuteHumanReevaluation,
  canUserOverrideRateOrFees,
  runIntegratedDecisionAndCalculation,
} from './src/engine/integratedCreditEngine';
import type { ExchangeRateAuditMetadata, UserRole } from './src/types/axycore';
import { canExecuteDisbursement, canUserApproveCommittee } from './src/engine/workflowGuards';
import { runGeminiDocumentOcrVerification } from './server/geminiOcr';
import { runGeminiBiometricVerification } from './server/geminiBiometric';
import {
  runAxyCoreDirectorAnalysis,
  runBelaAssistantTurn,
} from './server/geminiAssistant';
import {
  runRegulaAiAssistant,
  runRegulaDocumentEvaluation,
  runRegulaGapDiagnosis,
  runRegulaNormativeAnalysis,
  runRegulaReportDraft,
} from './server/regulaAi';
import { checkTenantApiAccess } from './src/engine/multiTenantEngine';
import * as webpush from 'web-push';
import {
  ALL_TRACKED_PUSH_STATUSES,
  buildApplicationCriticalPushPayload,
  CRITICAL_APPLICATION_STATUSES,
  isValidVapidPublicKey,
  normalizeVapidKey,
  shouldTriggerApplicationCriticalPush,
} from './src/engine/pushPayload';
import {
  generateDevOnlyTestPkcs12,
  loadDecryptedCertificateFromVault,
  parsePkcs12Certificate,
  signDgiiXmlEnveloped,
  storeEncryptedCertificateInVault,
  verifySupplierXmlSignature,
} from './server/dgiiCryptoAndSigner';
import {
  authenticateWithDgii,
  checkDgiiServiceStatus,
  queryDgiiTrackIdStatus,
  sendSignedOperationToDgii,
  submitSignedEcfToDgii,
} from './server/dgiiApiClient';
import { parseReceivedSupplierEcfXml } from './src/engine/dgii/dgiiXmlEngine';
import { OFFICIAL_DGII_ENV_ENDPOINTS } from './src/engine/dgii/dgiiCatalogAndValidation';
import {
  listLoadedDgiiXsdSchemas,
  registerDgiiXsdSchema,
  validateEcfBeforeDigitalSignature,
  validateXmlAgainstDgiiXsd,
  type DgiiSchemaDocumentKind,
} from './src/engine/dgii/xmlValidator';
import { DGII_XSD_METADATA } from './src/engine/dgii/xsd/officialDgiiXsd';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadOfficialDgiiXsdFilesFromDisk(): void {
  const xsdDir = path.resolve(__dirname, 'public', 'dgii-xsd');
  if (!fs.existsSync(xsdDir)) return;
  for (const [kind, meta] of Object.entries(DGII_XSD_METADATA)) {
    const filePath = path.join(xsdDir, meta.fileName);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      registerDgiiXsdSchema(kind as DgiiSchemaDocumentKind, content);
    }
  }
}

async function startServer() {
  loadOfficialDgiiXsdFilesFromDisk();
  const app = express();
  const PORT = 3000; // Dev server must run on port 3000 per AI Studio environment constraints

  app.use(express.json({ limit: '6mb' }));

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({
      service: 'axycore-loans-backend',
      status: 'ok',
      engineVersion: DEFAULT_POLICY_V2.version,
      timestamp: new Date().toISOString(),
    });
  });

  // Deterministic Credit Decision Engine V2 Endpoint
  app.post('/api/engine/score', (req, res) => {
    try {
      const {
        application,
        customer,
        policy,
        organization,
        useVerifiedData,
        executionTrigger,
        executedBy,
        executedByName,
      } = req.body ?? {};
      if (!application || !customer) {
        res.status(400).json({ error: 'Se requieren application y customer para ejecutar el motor V2.' });
        return;
      }
      if (
        application.organizationId &&
        customer.organizationId &&
        application.organizationId !== customer.organizationId
      ) {
        res.status(403).json({
          error: 'Violación de aislamiento Multi-Tenant: application y customer pertenecen a organizaciones distintas.',
        });
        return;
      }
      if (organization) {
        const apiAccess = checkTenantApiAccess({
          apiPath: '/api/engine/score',
          organization,
        });
        if (!apiAccess.allowed) {
          res.status(403).json({ error: apiAccess.reason });
          return;
        }
      }
      const effectivePolicy = policy ?? DEFAULT_POLICY_V2;
      const result = evaluateCreditDecisionV2({
        application,
        customer,
        policy: effectivePolicy,
        useVerifiedData: Boolean(useVerifiedData),
        executionTrigger: executionTrigger ?? 'INITIAL_SUBMIT',
        executedBy: executedBy ?? 'system_api',
        executedByName: executedByName ?? 'API Backend',
      });
      res.json(result);
    } catch (err) {
      console.error('Decision Engine Error:', err);
      res.status(500).json({ error: 'Error interno al ejecutar el Motor de Decisiones V2.' });
    }
  });

  // Deterministic Decimal-Safe Amortization Schedule Endpoint
  app.post('/api/amortization/simulate', (req, res) => {
    try {
      const result = generateAmortizationSchedule(req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Parámetros inválidos para tabla de amortización.',
      });
    }
  });

  // BCRD USD/DOP Exchange Rate Endpoint (1-hour cache + last-known fallback)
  let bcrdCache: { data: BcrdExchangeRateResult; expiresAtMs: number } | null = null;
  let lastValidBcrdRate: BcrdExchangeRateResult | null = null;

  async function resolveServerBcrdExchangeRate(forceRefresh = false): Promise<{
    ok: boolean;
    rate: BcrdExchangeRateResult | null;
    errorMessage?: string;
  }> {
    const nowMs = Date.now();
    if (!forceRefresh && bcrdCache && nowMs < bcrdCache.expiresAtMs) {
      return {
        ok: true,
        rate: {
          ...bcrdCache.data,
          desdeCache: true,
          automatica: true,
        },
      };
    }

    try {
      const response = await fetch('https://www.bancentral.gov.do/', {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AxyCore/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (!response.ok) {
        throw new Error(`BCRD respondió HTTP ${response.status}.`);
      }

      const html = await response.text();
      const parsed = extractBcrdExchangeRate(html);
      const obtainedAt = new Date()
        .toLocaleString('sv-SE', {
          timeZone: 'America/Santo_Domingo',
        })
        .replace(' ', 'T');

      const freshRate: BcrdExchangeRateResult = {
        ...parsed,
        obtenidaEn: obtainedAt,
        desdeCache: false,
        respaldo: false,
        automatica: true,
      };

      bcrdCache = {
        data: freshRate,
        expiresAtMs: nowMs + 3600 * 1000,
      };
      lastValidBcrdRate = freshRate;

      return { ok: true, rate: freshRate };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No fue posible consultar el BCRD.';
      if (lastValidBcrdRate) {
        return {
          ok: true,
          rate: {
            ...lastValidBcrdRate,
            desdeCache: false,
            respaldo: true,
            automatica: true,
            motivoRespaldo: message,
          },
          errorMessage: message,
        };
      }
      return {
        ok: false,
        rate: null,
        errorMessage: message,
      };
    }
  }

  async function buildServerExchangeRateMeta(
    currency: string,
    policy: typeof DEFAULT_POLICY_V2
  ): Promise<ExchangeRateAuditMetadata | null> {
    if (currency !== 'USD') return null;
    const bcrdRes = await resolveServerBcrdExchangeRate(false);
    const nowIso = new Date().toISOString();
    if (bcrdRes.ok && bcrdRes.rate && bcrdRes.rate.venta > 0) {
      return {
        applied: true,
        currencyPair: 'USD/DOP',
        sellRate: bcrdRes.rate.venta,
        source: bcrdRes.rate.fuente,
        rateDate: bcrdRes.rate.fecha,
        obtainedAtIso: bcrdRes.rate.obtenidaEn || nowIso,
        isAutomaticBcrd: true,
        isFallback: Boolean(bcrdRes.rate.respaldo),
        fallbackReason: bcrdRes.rate.motivoRespaldo ?? null,
        manualOverrideBy: null,
        manualOverrideByName: null,
      };
    }
    const fallbackRate =
      policy.exchangeRateConfig?.dopPerUsd && policy.exchangeRateConfig.dopPerUsd > 0
        ? policy.exchangeRateConfig.dopPerUsd
        : 60.0;
    return {
      applied: true,
      currencyPair: 'USD/DOP',
      sellRate: fallbackRate,
      source: policy.exchangeRateConfig?.source || 'Respaldo de política institucional',
      rateDate: policy.exchangeRateConfig?.rateDate || nowIso.slice(0, 10),
      obtainedAtIso: nowIso,
      isAutomaticBcrd: false,
      isFallback: true,
      fallbackReason: bcrdRes.errorMessage || 'BCRD no disponible al momento del cálculo.',
      manualOverrideBy: null,
      manualOverrideByName: null,
    };
  }

  app.get('/api/exchange-rate/bcrd', async (req, res) => {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const result = await resolveServerBcrdExchangeRate(forceRefresh);
    if (result.ok && result.rate) {
      res.json({
        ok: true,
        ...result.rate,
      });
      return;
    }

    res.json({
      ok: false,
      venta: null,
      fecha: null,
      fuente: 'Manual',
      desdeCache: false,
      respaldo: false,
      automatica: false,
      motivoRespaldo: result.errorMessage || 'No fue posible consultar el BCRD.',
    });
  });

  // Authoritative Integrated Decision Engine + Financial Calculation Pipeline (Stage 1->3)
  app.post('/api/applications/process-decision-and-calculation', async (req, res) => {
    try {
      const {
        application,
        customer,
        policy,
        organization,
        analysisType = 'SOLICITUD_INICIAL',
        version = 1,
        useVerifiedData = false,
        alternativeConditions = null,
        justification = null,
        actor,
      } = req.body ?? {};

      if (!application || !customer || !actor?.uid || !actor?.role) {
        res.status(400).json({
          error: 'Se requieren application, customer y actor para ejecutar el motor integrado.',
        });
        return;
      }

      if (
        application.organizationId &&
        customer.organizationId &&
        application.organizationId !== customer.organizationId
      ) {
        res.status(403).json({
          error:
            'Violación de aislamiento Multi-Tenant: solicitud y cliente pertenecen a organizaciones distintas.',
        });
        return;
      }

      if (organization) {
        const apiAccess = checkTenantApiAccess({
          apiPath: '/api/applications/process-decision-and-calculation',
          organization,
        });
        if (!apiAccess.allowed) {
          res.status(403).json({ error: apiAccess.reason });
          return;
        }
      }

      const actorRole = actor.role as UserRole;
      if (actorRole === 'EXTERNAL_CLIENT' && analysisType !== 'SOLICITUD_INICIAL') {
        res.status(403).json({
          error:
            'Acceso denegado: los clientes externos no pueden ejecutar reevaluaciones ni acceder a parámetros técnicos internos.',
        });
        return;
      }

      const effectivePolicy = policy ?? DEFAULT_POLICY_V2;
      const exchangeRateMeta = await buildServerExchangeRateMeta(
        application.currency,
        effectivePolicy
      );

      const integratedResult = runIntegratedDecisionAndCalculation({
        application,
        customer,
        policy: effectivePolicy,
        analysisType,
        version: Number(version) || 1,
        useVerifiedData: Boolean(useVerifiedData),
        alternativeConditions: actorRole === 'EXTERNAL_CLIENT' ? null : alternativeConditions,
        exchangeRateMeta,
        justification,
        actor: {
          uid: String(actor.uid),
          displayName: String(actor.displayName || 'Sistema AxyCore'),
          role: actorRole,
        },
        intent: 'EVALUATE_ONLY',
      });

      res.json(integratedResult);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Error interno al procesar el Motor de Decisiones y Cálculo Financiero.';
      const status = msg.includes('Acceso denegado') || msg.includes('autorización') ? 403 : 400;
      res.status(status).json({ error: msg });
    }
  });

  // Human Re-evaluation & Strict «ENVIAR A EVALUACIÓN» Gate Endpoint (Internal Staff Only)
  app.post('/api/applications/reevaluate', async (req, res) => {
    try {
      const {
        application,
        customer,
        policy,
        organization,
        version = 2,
        alternativeConditions,
        justification,
        actor,
        actorOrganizationId,
        intent = 'EVALUATE_ONLY',
      } = req.body ?? {};

      if (!application || !customer || !actor?.uid || !actor?.role) {
        res.status(400).json({
          error: 'Se requieren application, customer y actor autenticado para reevaluación humana.',
        });
        return;
      }

      const actorRole = actor.role as UserRole;
      if (!canUserExecuteHumanReevaluation(actorRole)) {
        res.status(403).json({
          error: `Acceso denegado: el rol ${actorRole} no está autorizado para ejecutar reevaluación humana ni modificar condiciones financieras.`,
        });
        return;
      }

      if (
        (application.organizationId &&
          customer.organizationId &&
          application.organizationId !== customer.organizationId) ||
        (actorOrganizationId &&
          application.organizationId &&
          actorOrganizationId !== application.organizationId)
      ) {
        res.status(403).json({
          error:
            'Violación de aislamiento Multi-Tenant: el usuario o cliente no pertenece a la organización de la solicitud.',
        });
        return;
      }

      if (organization) {
        const apiAccess = checkTenantApiAccess({
          apiPath: '/api/applications/reevaluate',
          organization,
        });
        if (!apiAccess.allowed) {
          res.status(403).json({ error: apiAccess.reason });
          return;
        }
      }

      if (
        alternativeConditions &&
        (alternativeConditions.useSuggestedRate === false ||
          (alternativeConditions.customLegalFeesAmount !== undefined &&
            alternativeConditions.customLegalFeesAmount !== null) ||
          (alternativeConditions.manualExchangeRate !== undefined &&
            alternativeConditions.manualExchangeRate !== null)) &&
        !canUserOverrideRateOrFees(actorRole)
      ) {
        res.status(403).json({
          error: `Permiso insuficiente: el rol ${actorRole} no puede sobrescribir tasa, gastos legales ni tipo de cambio.`,
        });
        return;
      }

      const effectivePolicy = policy ?? DEFAULT_POLICY_V2;
      const exchangeRateMeta = await buildServerExchangeRateMeta(
        application.currency,
        effectivePolicy
      );

      const integratedResult = runIntegratedDecisionAndCalculation({
        application,
        customer,
        policy: effectivePolicy,
        analysisType: 'REEVALUACION_HUMANA',
        version: Math.max(2, Number(version) || 2),
        useVerifiedData: false,
        alternativeConditions: alternativeConditions ?? null,
        exchangeRateMeta,
        justification: justification ?? null,
        actor: {
          uid: String(actor.uid),
          displayName: String(actor.displayName || 'Analista AxyCore'),
          role: actorRole,
        },
        intent: intent === 'SEND_TO_EVALUATION' ? 'SEND_TO_EVALUATION' : 'EVALUATE_ONLY',
      });

      if (intent === 'SEND_TO_EVALUATION' && !integratedResult.canSendToEvaluation) {
        res.status(422).json({
          error:
            'No es posible enviar la solicitud a Evaluación: no se cumplen todas las condiciones requeridas.',
          blockedReasons: integratedResult.sendToEvaluationBlockedReasons,
          result: integratedResult,
        });
        return;
      }

      res.json(integratedResult);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Error interno durante la reevaluación humana de la solicitud.';
      const status = msg.includes('Acceso denegado') || msg.includes('autorización') ? 403 : 400;
      res.status(status).json({ error: msg });
    }
  });

  // Committee Authority Pre-Check
  app.post('/api/workflow/check-committee-authority', (req, res) => {
    try {
      const result = canUserApproveCommittee(req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ allowed: false, reason: 'Error validando facultad de comité.' });
    }
  });

  // Disbursement Pre-Condition & Idempotency Pre-Check
  app.post('/api/workflow/check-disbursement', (req, res) => {
    try {
      const result = canExecuteDisbursement(req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ allowed: false, reason: 'Error validando precondiciones de desembolso.' });
    }
  });

  // =========================================================================
  // VAPID Web Push Subscription & Credit Application Status-Change Service
  // =========================================================================
  const vapidPublicKey =
    normalizeVapidKey(process.env.VITE_FIREBASE_VAPID_KEY) ||
    normalizeVapidKey(process.env.VAPID_PUBLIC_KEY);
  const vapidPrivateKey =
    normalizeVapidKey(process.env.VAPID_PRIVATE_KEY) ||
    normalizeVapidKey(process.env.FIREBASE_VAPID_PRIVATE_KEY);
  const vapidSubject =
    normalizeVapidKey(process.env.VAPID_SUBJECT) || 'mailto:notificaciones@axycore.local';
  const vapidPublicValid = isValidVapidPublicKey(vapidPublicKey);
  let vapidPrivateConfigured = false;

  if (vapidPublicValid && vapidPrivateKey.length >= 32) {
    try {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      vapidPrivateConfigured = true;
    } catch (err) {
      console.warn('VAPID private key configuration warning:', err);
      vapidPrivateConfigured = false;
    }
  }

  interface StoredServerPushSubscription {
    subscriptionId: string;
    organizationId: string;
    userId: string;
    userRole: string;
    userEmail: string;
    subscription: {
      endpoint: string;
      keys: {
        p256dh: string;
        auth: string;
      };
    };
    fcmToken: string | null;
    subscribedStatuses: string[];
    updatedAtIso: string;
  }

  interface PushSseClient {
    id: string;
    organizationId: string;
    userId: string;
    userRole: string;
    res: express.Response;
  }

  const pushSubscriptionsRegistry = new Map<string, StoredServerPushSubscription>();
  const pushSseClients = new Map<string, PushSseClient>();

  async function dispatchPushForStatusChange(params: {
    application: {
      id: string;
      organizationId?: string;
      applicationNumber: string;
      applicantDisplayName: string;
      channel: 'INTERNAL' | 'EXTERNAL';
      productCode: string;
      currency: 'DOP' | 'USD';
      requestedAmount: number;
      status: string;
      createdBy?: string;
    };
    prevStatus?: string | null;
    triggeredByUid?: string | null;
  }) {
    const { application, prevStatus } = params;
    const isCritical = shouldTriggerApplicationCriticalPush(prevStatus, application.status);
    const staffPayload = buildApplicationCriticalPushPayload(application as never, {
      prevStatus,
      audience: 'STAFF',
    });
    const clientPayload = buildApplicationCriticalPushPayload(application as never, {
      prevStatus,
      audience: 'CLIENT',
    });

    if (!isCritical) {
      return {
        success: true,
        isCritical: false,
        payload: staffPayload,
        matchedSubscriptions: 0,
        deliveredViaWebPush: 0,
        deliveredViaRelay: 0,
        dispatchedAt: new Date().toISOString(),
      };
    }

    const appOrgId = application.organizationId || 'org_axycore_main';
    const applicantUid = application.createdBy || '';
    const matchedSubs: StoredServerPushSubscription[] = [];

    for (const sub of pushSubscriptionsRegistry.values()) {
      if (sub.organizationId !== appOrgId) continue;
      const isSubExternal = sub.userRole === 'EXTERNAL_CLIENT';
      if (isSubExternal && (!applicantUid || sub.userId !== applicantUid)) {
        continue;
      }
      if (
        Array.isArray(sub.subscribedStatuses) &&
        sub.subscribedStatuses.length > 0 &&
        !sub.subscribedStatuses.includes(application.status)
      ) {
        continue;
      }
      matchedSubs.push(sub);
    }

    let deliveredViaWebPush = 0;
    if (vapidPrivateConfigured && matchedSubs.length > 0) {
      await Promise.all(
        matchedSubs.map(async (sub) => {
          const targetPayload = sub.userRole === 'EXTERNAL_CLIENT' ? clientPayload : staffPayload;
          try {
            await webpush.sendNotification(
              sub.subscription,
              JSON.stringify({
                title: targetPayload.title,
                body: targetPayload.body,
                priority: targetPayload.priority,
                targetSection: targetPayload.targetSection,
                applicationId: application.id,
                tag: targetPayload.ackKey,
                data: targetPayload.data,
              }),
              { TTL: 3600 }
            );
            deliveredViaWebPush++;
          } catch (err) {
            const statusCode = (err as { statusCode?: number })?.statusCode;
            if (statusCode === 404 || statusCode === 410) {
              pushSubscriptionsRegistry.delete(sub.subscription.endpoint);
            }
          }
        })
      );
    }

    // Real-time SSE relay for open tabs / sessions
    let deliveredViaRelay = 0;
    for (const client of pushSseClients.values()) {
      if (client.organizationId !== appOrgId) continue;
      const isClientExternal = client.userRole === 'EXTERNAL_CLIENT';
      if (isClientExternal && (!applicantUid || client.userId !== applicantUid)) {
        continue;
      }
      const targetPayload = isClientExternal ? clientPayload : staffPayload;
      try {
        client.res.write(
          `event: credit_status_change\ndata: ${JSON.stringify({
            ...targetPayload,
            applicationId: application.id,
            status: application.status,
            previousStatus: prevStatus ?? null,
            dispatchedAt: new Date().toISOString(),
          })}\n\n`
        );
        deliveredViaRelay++;
      } catch {
        pushSseClients.delete(client.id);
      }
    }

    return {
      success: true,
      isCritical: true,
      payload: staffPayload,
      clientPayload,
      matchedSubscriptions: matchedSubs.length,
      deliveredViaWebPush,
      deliveredViaRelay,
      vapidPrivateConfigured,
      dispatchedAt: new Date().toISOString(),
    };
  }

  // Expose public VAPID key defined in .env
  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({
      configured: vapidPublicValid,
      publicKey: vapidPublicValid ? vapidPublicKey : '',
      vapidPrivateConfigured,
      vapidMode: vapidPrivateConfigured
        ? 'FULL_VAPID_WEB_PUSH'
        : 'VAPID_PUBLIC_KEY_AND_SW_RELAY',
      subject: vapidSubject,
      supportedStatuses: ALL_TRACKED_PUSH_STATUSES,
    });
  });

  // Register a browser PushSubscription created with the .env VAPID key
  app.post('/api/push/subscribe', (req, res) => {
    try {
      const {
        subscriptionId,
        organizationId,
        userId,
        userRole,
        userEmail,
        subscription,
        fcmToken,
        subscribedStatuses,
      } = req.body ?? {};

      if (
        !userId ||
        !subscription ||
        typeof subscription.endpoint !== 'string' ||
        !subscription.endpoint.trim() ||
        !subscription.keys?.p256dh ||
        !subscription.keys?.auth
      ) {
        res.status(400).json({
          ok: false,
          error: 'Suscripción Push VAPID incompleta (se requieren userId, endpoint, p256dh y auth).',
        });
        return;
      }

      const endpoint = subscription.endpoint.trim();
      const entry: StoredServerPushSubscription = {
        subscriptionId: String(subscriptionId || crypto.randomBytes(12).toString('hex')),
        organizationId: String(organizationId || 'org_axycore_main'),
        userId: String(userId),
        userRole: String(userRole || 'EXTERNAL_CLIENT'),
        userEmail: String(userEmail || ''),
        subscription: {
          endpoint,
          keys: {
            p256dh: String(subscription.keys.p256dh),
            auth: String(subscription.keys.auth),
          },
        },
        fcmToken: typeof fcmToken === 'string' && fcmToken.trim() ? fcmToken.trim() : null,
        subscribedStatuses:
          Array.isArray(subscribedStatuses) && subscribedStatuses.length > 0
            ? subscribedStatuses.map((s: unknown) => String(s))
            : [...ALL_TRACKED_PUSH_STATUSES],
        updatedAtIso: new Date().toISOString(),
      };

      pushSubscriptionsRegistry.set(endpoint, entry);
      res.json({
        ok: true,
        subscriptionId: entry.subscriptionId,
        activeCount: pushSubscriptionsRegistry.size,
        vapidPrivateConfigured,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error registrando suscripción Web Push.',
      });
    }
  });

  // Remove/revoke a browser PushSubscription
  app.post('/api/push/unsubscribe', (req, res) => {
    const { userId, endpoint, subscriptionId } = req.body ?? {};
    let removed = 0;
    if (typeof endpoint === 'string' && endpoint.trim()) {
      if (pushSubscriptionsRegistry.delete(endpoint.trim())) removed++;
    } else if (subscriptionId || userId) {
      for (const [key, entry] of pushSubscriptionsRegistry.entries()) {
        if (
          (subscriptionId && entry.subscriptionId === String(subscriptionId)) ||
          (!subscriptionId && userId && entry.userId === String(userId))
        ) {
          pushSubscriptionsRegistry.delete(key);
          removed++;
        }
      }
    }
    res.json({ ok: true, removed, activeCount: pushSubscriptionsRegistry.size });
  });

  // SSE stream for real-time status-change push relay
  app.get('/api/push/events', (req, res) => {
    const organizationId = String(req.query.organizationId || 'org_axycore_main').trim();
    const userId = String(req.query.userId || '').trim();
    const userRole = String(req.query.userRole || 'EXTERNAL_CLIENT').trim();
    if (!userId) {
      res.status(400).json({ error: 'Se requiere userId para suscribirse al flujo de eventos Push.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const clientId = crypto.randomBytes(12).toString('hex');
    pushSseClients.set(clientId, { id: clientId, organizationId, userId, userRole, res });

    res.write(
      `event: connected\ndata: ${JSON.stringify({
        clientId,
        vapidConfigured: vapidPublicValid,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
        pushSseClients.delete(clientId);
      }
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
      pushSseClients.delete(clientId);
    });
  });

  // Notify subscribed users when a credit application changes status
  app.post('/api/push/notify-status-change', async (req, res) => {
    try {
      const { application, prevStatus, triggeredByUid } = req.body ?? {};
      if (!application || !application.id || !application.status) {
        res.status(400).json({ error: 'Se requiere objeto application válido con id y status.' });
        return;
      }
      const result = await dispatchPushForStatusChange({
        application,
        prevStatus,
        triggeredByUid,
      });
      res.json(result);
    } catch (err) {
      console.error('Push Status-Change Dispatch Error:', err);
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Error despachando notificación Push de cambio de estado.',
      });
    }
  });

  // Test Push endpoint for verifying a user's active VAPID subscription
  app.post('/api/push/test', async (req, res) => {
    try {
      const { userId, endpoint, title, body, targetSection } = req.body ?? {};
      if (!userId) {
        res.status(400).json({ ok: false, error: 'Se requiere userId para enviar Push de prueba.' });
        return;
      }

      const targets: StoredServerPushSubscription[] = [];
      for (const entry of pushSubscriptionsRegistry.values()) {
        if (endpoint && entry.subscription.endpoint === String(endpoint)) {
          targets.push(entry);
        } else if (!endpoint && entry.userId === String(userId)) {
          targets.push(entry);
        }
      }

      let deliveredViaWebPush = 0;
      if (vapidPrivateConfigured && targets.length > 0) {
        await Promise.all(
          targets.map(async (sub) => {
            try {
              await webpush.sendNotification(
                sub.subscription,
                JSON.stringify({
                  title: String(title || 'AxyCore · Notificación Push VAPID'),
                  body: String(
                    body || 'Prueba exitosa de suscripción a notificaciones Push de solicitudes de crédito.'
                  ),
                  targetSection: String(targetSection || 'applications'),
                  tag: `axycore_test_${Date.now()}`,
                  data: {
                    targetSection: String(targetSection || 'applications'),
                    title: String(title || 'AxyCore · Notificación Push VAPID'),
                    body: String(body || 'Prueba exitosa de suscripción Web Push.'),
                  },
                }),
                { TTL: 600 }
              );
              deliveredViaWebPush++;
            } catch (err) {
              const statusCode = (err as { statusCode?: number })?.statusCode;
              if (statusCode === 404 || statusCode === 410) {
                pushSubscriptionsRegistry.delete(sub.subscription.endpoint);
              }
            }
          })
        );
      }

      res.json({
        ok: true,
        matchedSubscriptions: targets.length,
        deliveredViaWebPush,
        vapidPrivateConfigured,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error enviando notificación Push de prueba.',
      });
    }
  });

  // Email & Web Push Notification Configuration Status
  app.get('/api/notifications/status', (_req, res) => {
    const smtpConfigured = Boolean(
      process.env.SMTP_HOST?.trim() &&
        process.env.SMTP_USER?.trim() &&
        process.env.SMTP_PASS?.trim()
    );
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const geminiOcrConfigured = Boolean(geminiKey && geminiKey !== 'MY_GEMINI_API_KEY');
    res.json({
      status: 'ok',
      smtpConfigured,
      fcmVapidConfigured: vapidPublicValid,
      fcmWebPushConfigured: vapidPublicValid,
      vapidKeyConfigured: vapidPublicValid,
      vapidPrivateConfigured,
      vapidKeyPublicPrefix: vapidPublicValid ? vapidPublicKey.slice(0, 14) + '...' : '',
      activePushSubscriptionsCount: pushSubscriptionsRegistry.size,
      provider: vapidPrivateConfigured
        ? 'Web Push VAPID (RFC 8292) + Firebase Cloud Messaging'
        : 'Web Push VAPID (PushManager + SW Relay)',
      supportedCriticalStatuses: Array.from(CRITICAL_APPLICATION_STATUSES),
      geminiOcrConfigured,
      biometricVisionConfigured: geminiOcrConfigured,
      fcmCloudFunctionName: 'onInboxApplicationPushAlert',
      cloudFunctionDatabaseId: 'ai-studio-9b309ae7-68ea-4ea1-9929-9d3c75b385ee',
      cloudFunctionsEntrypoint: 'functions/src/index.ts',
      timestamp: new Date().toISOString(),
    });
  });

  // Server-side Gemini OCR Document Verifier Endpoint
  app.post('/api/documents/verify-ocr', async (req, res) => {
    try {
      const result = await runGeminiDocumentOcrVerification(req.body ?? {});
      res.json(result);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Error procesando verificación OCR con Gemini.';
      const status = msg.includes('GEMINI_API_KEY no está configurada')
        ? 503
        : msg.includes('inválido') || msg.includes('no compatible') || msg.includes('no contiene')
        ? 400
        : 502;
      console.error('Gemini OCR Verification Error:', err);
      res.status(status).json({ error: msg });
    }
  });

  // Server-side Gemini Vision Biometric Identity Verification Endpoint
  app.post('/api/biometrics/verify-identity', async (req, res) => {
    try {
      const result = await runGeminiBiometricVerification(req.body ?? {});
      res.json(result);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Error ejecutando comparación biométrica con visión artificial.';
      const status = msg.includes('GEMINI_API_KEY no está configurada')
        ? 503
        : msg.includes('Debes ') || msg.includes('inválido') || msg.includes('no compatible')
        ? 400
        : 502;
      console.error('Gemini Biometric Verification Error:', err);
      res.status(status).json({ error: msg });
    }
  });

  // Server-side Gemini AI Status
  app.get('/api/ai/status', (_req, res) => {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const configured = Boolean(geminiKey && geminiKey !== 'MY_GEMINI_API_KEY');
    res.json({
      configured,
      model: 'gemini-4-hydrogen',
      features: ['director', 'bela', 'ocr', 'biometrics', 'regula'],
    });
  });

  // Server-side AxyCore Director Executive Intelligence Endpoint
  app.post('/api/ai/director', async (req, res) => {
    try {
      const { question, scopedContext, actorId, organization } = req.body ?? {};
      if (!scopedContext || typeof scopedContext !== 'object') {
        res.status(400).json({ error: 'Se requiere scopedContext autorizado para AxyCore Director.' });
        return;
      }
      if (organization) {
        const apiAccess = checkTenantApiAccess({
          apiPath: '/api/ai/director',
          organization,
        });
        if (!apiAccess.allowed) {
          res.status(403).json({ error: apiAccess.reason });
          return;
        }
      }
      const result = await runAxyCoreDirectorAnalysis({
        question: typeof question === 'string' ? question : undefined,
        scopedContext,
        actorId: typeof actorId === 'string' ? actorId : undefined,
      });
      res.json(result);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Error ejecutando análisis ejecutivo de AxyCore Director.';
      const status = msg.includes('GEMINI_API_KEY no está configurada')
        ? 503
        : msg.includes('Límite temporal')
        ? 429
        : msg.includes('tiempo máximo')
        ? 504
        : 502;
      console.error('AxyCore Director Error:', err);
      res.status(status).json({ error: msg });
    }
  });

  // Server-side Bela Virtual Assistant Endpoint
  app.post('/api/ai/bela', async (req, res) => {
    try {
      const { message, history, scopedContext, actorId, organization } = req.body ?? {};
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Escribe una consulta válida para Bela.' });
        return;
      }
      if (!scopedContext || typeof scopedContext !== 'object') {
        res.status(400).json({ error: 'Se requiere scopedContext autorizado para Bela.' });
        return;
      }
      if (organization) {
        const apiAccess = checkTenantApiAccess({
          apiPath: '/api/ai/bela',
          organization,
        });
        if (!apiAccess.allowed) {
          res.status(403).json({ error: apiAccess.reason });
          return;
        }
      }
      const result = await runBelaAssistantTurn({
        message,
        history: Array.isArray(history) ? history : [],
        scopedContext,
        actorId: typeof actorId === 'string' ? actorId : undefined,
      });
      res.json(result);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Error consultando a la asistente virtual Bela.';
      const status = msg.includes('GEMINI_API_KEY no está configurada')
        ? 503
        : msg.includes('Límite temporal')
        ? 429
        : msg.includes('tiempo máximo')
        ? 504
        : 502;
      console.error('Bela Assistant Error:', err);
      res.status(status).json({ error: msg });
    }
  });

  // Email Notification Dispatch Relay (uses real SMTP when configured; otherwise leaves queued for Cloud Functions)
  app.post('/api/notifications/dispatch-email', async (req, res) => {
    try {
      const { to, subject, text, html } = req.body ?? {};
      if (!to || !subject || !text) {
        res.status(400).json({ delivered: false, reason: 'Faltan destinatario, asunto o contenido del correo.' });
        return;
      }

      const host = process.env.SMTP_HOST?.trim();
      const user = process.env.SMTP_USER?.trim();
      const pass = process.env.SMTP_PASS?.trim();
      const port = Number(process.env.SMTP_PORT || 587);
      const from = process.env.SMTP_FROM?.trim() || user || 'notificaciones@axycore.local';

      if (!host || !user || !pass) {
        res.json({
          delivered: false,
          deliveryChannel: 'CLOUD_FUNCTION_PENDING_SMTP',
          reason:
            'SMTP no configurado en este servidor; notificación registrada en Firestore (email_notifications) para procesamiento por Firebase Cloud Functions.',
        });
        return;
      }

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });

      const info = await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html: html || undefined,
      });

      res.json({
        delivered: true,
        deliveryChannel: 'EXPRESS_SMTP_RELAY',
        providerMessageId: info.messageId ?? null,
      });
    } catch (err) {
      console.error('SMTP Dispatch Error:', err);
      res.status(502).json({
        delivered: false,
        deliveryChannel: 'EXPRESS_SMTP_RELAY',
        reason: err instanceof Error ? err.message : 'Error enviando correo vía SMTP.',
      });
    }
  });

  // Collections External Integrations Honest Status Check
  app.get('/api/collections/integrations-status', (_req, res) => {
    const whatsappCloudConfigured = Boolean(
      process.env.WHATSAPP_CLOUD_API_TOKEN?.trim() &&
        process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
    );
    const whatsappWebhookConfigured = Boolean(
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim()
    );
    const bankApiConfigured = Boolean(
      process.env.BANK_CONNECTOR_API_URL?.trim() &&
        process.env.BANK_CONNECTOR_API_KEY?.trim()
    );
    res.json({
      timezone: 'America/Santo_Domingo',
      whatsappCloudConfigured,
      whatsappWebhookConfigured,
      whatsappStatus: whatsappCloudConfigured ? 'CONFIGURADO' : 'INTEGRACION_PENDIENTE',
      bankApiConfigured,
      bankStatus: bankApiConfigured ? 'CONFIGURADO' : 'INTEGRACION_PENDIENTE',
      scheduledBatchStatus: 'EJECUCION_BAJO_DEMANDA_Y_CRON_PENDIENTE',
    });
  });

  // WhatsApp Business Cloud API Real Dispatch (returns INTEGRACION_PENDIENTE when unconfigured)
  app.post('/api/collections/bot/dispatch', async (req, res) => {
    try {
      const { to, messageBody, templateCode } = req.body ?? {};
      const token = process.env.WHATSAPP_CLOUD_API_TOKEN?.trim();
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();

      if (!token || !phoneNumberId) {
        res.json({
          sent: false,
          status: 'INTEGRACION_PENDIENTE',
          reason:
            'WhatsApp Business Cloud API pendiente: configure WHATSAPP_CLOUD_API_TOKEN y WHATSAPP_PHONE_NUMBER_ID en el servidor.',
        });
        return;
      }

      if (!to || !messageBody) {
        res.status(400).json({ sent: false, reason: 'Faltan destinatario (to) o cuerpo del mensaje.' });
        return;
      }

      const normalizedPhone = String(to).replace(/\D/g, '');
      const graphResp = await fetch(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: normalizedPhone,
            type: 'text',
            text: { body: String(messageBody) },
            ...(templateCode ? { biz_opaque_callback_data: String(templateCode) } : {}),
          }),
        }
      );

      const graphData = (await graphResp.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string };
      };
      if (!graphResp.ok) {
        res.status(502).json({
          sent: false,
          status: 'ERROR_PROVEEDOR',
          reason: graphData.error?.message || 'Error enviando mensaje a WhatsApp Cloud API.',
        });
        return;
      }

      res.json({
        sent: true,
        status: 'ENVIADO',
        externalMessageId: graphData.messages?.[0]?.id ?? null,
      });
    } catch (err) {
      res.status(502).json({
        sent: false,
        status: 'ERROR_PROVEEDOR',
        reason: err instanceof Error ? err.message : 'Error conectando con WhatsApp Cloud API.',
      });
    }
  });

  // Meta WhatsApp Webhook Verification Endpoint
  app.get('/api/collections/bot/webhook', (req, res) => {
    const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (verifyToken && mode === 'subscribe' && token === verifyToken) {
      res.status(200).send(String(challenge ?? ''));
      return;
    }
    res.status(403).json({ error: 'Webhook verification failed or token unconfigured.' });
  });

  // Critical Credit Application Web Push Dispatch Endpoint (delegates to VAPID dispatcher)
  app.post('/api/notifications/dispatch-push', async (req, res) => {
    try {
      const { application, prevStatus, triggeredByUid } = req.body ?? {};
      if (!application || !application.id || !application.status) {
        res.status(400).json({ error: 'Se requiere objeto application válido con id y status.' });
        return;
      }

      const result = await dispatchPushForStatusChange({
        application,
        prevStatus,
        triggeredByUid,
      });
      res.json(result);
    } catch (err) {
      console.error('Push Dispatch Error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Error preparando despacho de notificación Web Push.',
      });
    }
  });

  // =========================================================================
  // WebAuthn / FIDO2 Biometric Authentication (FaceID / TouchID / Huella)
  // =========================================================================
  const webauthnChallenges = new Map<
    string,
    { challenge: string; uid: string; purpose: string; expiresAt: number }
  >();

  const pruneExpiredChallenges = () => {
    const now = Date.now();
    for (const [key, entry] of webauthnChallenges.entries()) {
      if (entry.expiresAt <= now) {
        webauthnChallenges.delete(key);
      }
    }
  };

  app.post('/api/auth/webauthn/challenge', (req, res) => {
    try {
      pruneExpiredChallenges();
      const { uid, purpose } = req.body ?? {};
      const challengeId = crypto.randomBytes(16).toString('base64url');
      const challenge = crypto.randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + 5 * 60 * 1000;

      webauthnChallenges.set(challengeId, {
        challenge,
        uid: typeof uid === 'string' && uid.trim() ? uid.trim() : 'anonymous',
        purpose: purpose === 'register' ? 'register' : 'authenticate',
        expiresAt,
      });

      res.json({
        challengeId,
        challenge,
        expiresAtIso: new Date(expiresAt).toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Error generando challenge biométrico WebAuthn.',
      });
    }
  });

  app.post('/api/auth/webauthn/verify', (req, res) => {
    try {
      pruneExpiredChallenges();
      const {
        challengeId,
        uid,
        clientDataJSON,
        authenticatorData,
        signature,
        publicKeySpki,
        expectedOrigin,
      } = req.body ?? {};

      if (!challengeId || !clientDataJSON || !authenticatorData || !signature) {
        res.status(400).json({ error: 'Faltan parámetros criptográficos para verificar la aserción biométrica.' });
        return;
      }

      const stored = webauthnChallenges.get(String(challengeId));
      webauthnChallenges.delete(String(challengeId)); // Single-use anti-replay enforcement

      if (!stored || stored.expiresAt <= Date.now()) {
        res.status(400).json({ error: 'El challenge biométrico expiró o ya fue utilizado.' });
        return;
      }
      if (uid && stored.uid !== 'anonymous' && stored.uid !== String(uid)) {
        res.status(403).json({ error: 'El challenge biométrico no corresponde al usuario solicitado.' });
        return;
      }

      const clientDataBuf = Buffer.from(String(clientDataJSON), 'base64url');
      const clientData = JSON.parse(clientDataBuf.toString('utf8')) as {
        type?: string;
        challenge?: string;
        origin?: string;
      };

      if (clientData.type !== 'webauthn.get') {
        res.status(400).json({ error: 'Tipo de aserción WebAuthn inválido.' });
        return;
      }
      if (clientData.challenge !== stored.challenge) {
        res.status(400).json({ error: 'Challenge WebAuthn no coincide con la sesión emitida.' });
        return;
      }
      if (expectedOrigin && clientData.origin !== String(expectedOrigin)) {
        res.status(403).json({ error: 'Origen WebAuthn no autorizado.' });
        return;
      }

      const authDataBuf = Buffer.from(String(authenticatorData), 'base64url');
      if (authDataBuf.length < 37) {
        res.status(400).json({ error: 'authenticatorData inválido.' });
        return;
      }
      const flags = authDataBuf[32];
      const userPresent = (flags & 0x01) !== 0;
      const userVerified = (flags & 0x04) !== 0;
      if (!userPresent || !userVerified) {
        res.status(401).json({
          error: 'El autenticador no confirmó verificación biométrica de usuario (FaceID / TouchID requerido).',
        });
        return;
      }

      const signCount = authDataBuf.readUInt32BE(33);

      if (publicKeySpki) {
        const spkiBuf = Buffer.from(String(publicKeySpki), 'base64url');
        const sigBuf = Buffer.from(String(signature), 'base64url');
        const clientDataHash = crypto.createHash('sha256').update(clientDataBuf).digest();
        const signedPayload = Buffer.concat([authDataBuf, clientDataHash]);
        const pubKeyObj = crypto.createPublicKey({
          key: spkiBuf,
          format: 'der',
          type: 'spki',
        });
        const verifier = crypto.createVerify('SHA256');
        verifier.update(signedPayload);
        verifier.end();
        const sigOk = verifier.verify(pubKeyObj, sigBuf);
        if (!sigOk) {
          res.status(401).json({ error: 'Firma criptográfica biométrica inválida.' });
          return;
        }
      }

      res.json({
        verified: true,
        userPresent: true,
        userVerified: true,
        signCount,
        verifiedAtIso: new Date().toISOString(),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Error validando credencial biométrica.',
      });
    }
  });

  // =========================================================================
  // Multi-Tenant Corporate Access Code Resolution (Pre-Login & Sync)
  // =========================================================================
  interface CorporateDirectoryEntry {
    id: string;
    tenantId: string;
    accessCode: string;
    name: string;
    tradeName: string;
    status: string;
    planCode: string;
  }

  const corporateDirectory = new Map<string, CorporateDirectoryEntry>([
    [
      'org_axycore_main',
      {
        id: 'org_axycore_main',
        tenantId: 'su-gloria-mano-amiga',
        accessCode: 'SGMA-001',
        name: 'SU GLORIA MANO AMIGA',
        tradeName: 'SU GLORIA MANO AMIGA',
        status: 'ACTIVA',
        planCode: 'CORPORATIVO',
      },
    ],
  ]);

  app.post('/api/tenants/sync-directory', (req, res) => {
    try {
      const list = Array.isArray(req.body?.organizations) ? req.body.organizations : [];
      let synced = 0;
      for (const raw of list) {
        if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) continue;
        const id = raw.id.trim();
        const tenantId =
          typeof raw.tenantId === 'string' && raw.tenantId.trim()
            ? raw.tenantId.trim()
            : typeof raw.tenant_id === 'string' && raw.tenant_id.trim()
            ? raw.tenant_id.trim()
            : id;
        const accessCode =
          typeof raw.accessCode === 'string' && raw.accessCode.trim()
            ? raw.accessCode.trim().toUpperCase()
            : id === 'org_axycore_main'
            ? 'SGMA-001'
            : tenantId.toUpperCase().slice(0, 14);
        corporateDirectory.set(id, {
          id,
          tenantId,
          accessCode,
          name: String(raw.name || raw.tradeName || id),
          tradeName: String(raw.tradeName || raw.name || id),
          status: String(raw.status || 'ACTIVA'),
          planCode: String(raw.planCode || 'EMPRESARIAL'),
        });
        synced++;
      }
      res.json({ ok: true, synced, total: corporateDirectory.size });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Error sincronizando directorio corporativo.' });
    }
  });

  app.post('/api/auth/resolve-corporate-code', (req, res) => {
    const rawCode = String(req.body?.code || '').trim();
    if (!rawCode) {
      res.status(400).json({ found: false, error: 'Ingresa el código único asignado a tu empresa.' });
      return;
    }

    const upper = rawCode.toUpperCase();
    const lower = rawCode.toLowerCase();

    let match: CorporateDirectoryEntry | null = null;
    for (const entry of corporateDirectory.values()) {
      if (
        entry.accessCode.toUpperCase() === upper ||
        entry.tenantId.toLowerCase() === lower ||
        entry.id.toLowerCase() === lower
      ) {
        match = entry;
        break;
      }
    }

    if (!match) {
      res.status(404).json({
        found: false,
        error: `No se encontró ninguna entidad registrada con el código "${upper}". Verifica con el administrador de tu empresa o AxyCore.`,
      });
      return;
    }

    if (['SUSPENDIDA', 'DESACTIVADA', 'INACTIVA'].includes(match.status.toUpperCase())) {
      res.status(403).json({
        found: false,
        error: `La empresa "${match.tradeName}" se encuentra ${match.status}. Contacta a Administración AxyCore.`,
      });
      return;
    }

    res.json({
      found: true,
      organization: match,
    });
  });

  // ============================================================================
  // DGII Facturación Electrónica (Ley 32-23) — Bóveda Cifrada, Firma XMLDSig y API
  // ============================================================================

  app.post('/api/dgii/certificates/upload', (req, res) => {
    try {
      const { organizationId, p12Base64, password, organization } = req.body ?? {};
      if (!organizationId || !p12Base64 || typeof password !== 'string') {
        res.status(400).json({
          ok: false,
          error: 'Se requiere organizationId, archivo PKCS#12 (.p12/.pfx) y contraseña.',
        });
        return;
      }
      if (organization) {
        const apiAccess = checkTenantApiAccess({
          apiPath: '/api/dgii/certificates/upload',
          organization,
        });
        if (!apiAccess.allowed) {
          res.status(403).json({ ok: false, error: apiAccess.reason });
          return;
        }
      }
      const parsed = parsePkcs12Certificate(String(p12Base64), password);
      const vaultKeyId = `vault_${String(organizationId).replace(/[^a-zA-Z0-9_-]/g, '')}_${crypto
        .randomBytes(6)
        .toString('hex')}`;
      const { usingEnvMasterKey } = storeEncryptedCertificateInVault({
        organizationId: String(organizationId),
        vaultKeyId,
        privateKeyPem: parsed.privateKeyPem,
        certificatePem: parsed.certificatePem,
      });

      res.json({
        ok: true,
        metadata: {
          subjectCn: parsed.subjectCn,
          subjectRnc: parsed.subjectRnc,
          issuerCn: parsed.issuerCn,
          serialNumber: parsed.serialNumber,
          fingerprintSha256: parsed.fingerprintSha256,
          validFrom: parsed.validFrom,
          validTo: parsed.validTo,
          vaultKeyId,
          usingEnvMasterKey,
        },
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'No se pudo procesar el certificado PKCS#12. Verifique el archivo y la contraseña.',
      });
    }
  });

  app.post('/api/dgii/certificates/generate-dev-test', (req, res) => {
    try {
      const { organizationId, rnc, legalName } = req.body ?? {};
      if (!organizationId || !rnc || !legalName) {
        res.status(400).json({
          ok: false,
          error: 'Se requiere organizationId, RNC y Razón Social para generar certificado de pruebas DEV.',
        });
        return;
      }
      const ephemeralPass = crypto.randomBytes(16).toString('hex');
      const { summary } = generateDevOnlyTestPkcs12({
        rnc: String(rnc),
        legalName: String(legalName),
        password: ephemeralPass,
      });
      const vaultKeyId = `vault_dev_${String(organizationId).replace(/[^a-zA-Z0-9_-]/g, '')}_${crypto
        .randomBytes(6)
        .toString('hex')}`;
      const { usingEnvMasterKey } = storeEncryptedCertificateInVault({
        organizationId: String(organizationId),
        vaultKeyId,
        privateKeyPem: summary.privateKeyPem,
        certificatePem: summary.certificatePem,
      });

      res.json({
        ok: true,
        isDevelopmentOnlyCert: true,
        metadata: {
          subjectCn: summary.subjectCn,
          subjectRnc: summary.subjectRnc,
          issuerCn: summary.issuerCn,
          serialNumber: summary.serialNumber,
          fingerprintSha256: summary.fingerprintSha256,
          validFrom: summary.validFrom,
          validTo: summary.validTo,
          vaultKeyId,
          usingEnvMasterKey,
        },
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error generando certificado de pruebas DEV.',
      });
    }
  });

  app.get('/api/dgii/xsd/schemas', (_req, res) => {
    try {
      const schemas = listLoadedDgiiXsdSchemas();
      res.json({ ok: true, count: schemas.length, schemas });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error listando esquemas XSD DGII.',
      });
    }
  });

  app.post('/api/dgii/xml/validate', (req, res) => {
    try {
      const { xml, expectedKind, allowSignature } = req.body ?? {};
      if (!xml || typeof xml !== 'string') {
        res.status(400).json({ ok: false, error: 'Se requiere el contenido XML para validar.' });
        return;
      }
      const result = validateXmlAgainstDgiiXsd(xml, expectedKind, {
        allowSignature: Boolean(allowSignature),
        enforceLey3223Rules: true,
      });
      res.json({ ok: result.valid, validation: result });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error validando estructura XML contra XSD DGII.',
      });
    }
  });

  app.post('/api/dgii/xml/sign', (req, res) => {
    try {
      const { organizationId, vaultKeyId, xml, expectedKind } = req.body ?? {};
      if (!organizationId || !vaultKeyId || !xml) {
        res.status(400).json({ ok: false, error: 'Se requiere organizationId, vaultKeyId y xml.' });
        return;
      }
      const preSignXsd = validateEcfBeforeDigitalSignature(String(xml), expectedKind);
      if (!preSignXsd.valid) {
        res.status(422).json({
          ok: false,
          error: `Validación XSD DGII previa a firma fallida (${preSignXsd.schemaFileName}): ${preSignXsd.errors.join(' | ')}`,
          validation: preSignXsd,
        });
        return;
      }
      const { privateKeyPem, certificatePem } = loadDecryptedCertificateFromVault({
        organizationId: String(organizationId),
        vaultKeyId: String(vaultKeyId),
      });
      const signed = signDgiiXmlEnveloped({
        xml: String(xml),
        privateKeyPem,
        certificatePem,
      });
      res.json({
        ok: true,
        signedXml: signed.signedXml,
        securityCode: signed.securityCode,
        sha256Hex: signed.sha256Hex,
        signedAt: new Date().toISOString(),
        xsdValidation: preSignXsd,
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error firmando XML con certificado digital.',
      });
    }
  });

  app.post('/api/dgii/xml/verify-supplier', (req, res) => {
    try {
      const { xml } = req.body ?? {};
      if (!xml || typeof xml !== 'string') {
        res.status(400).json({ ok: false, error: 'Debe proporcionar el contenido XML del proveedor.' });
        return;
      }
      const parsed = parseReceivedSupplierEcfXml(xml);
      const structural = validateXmlAgainstDgiiXsd(xml, parsed.ecfType, {
        allowSignature: true,
        enforceLey3223Rules: true,
      });
      const signature = verifySupplierXmlSignature(xml);
      res.json({
        ok: true,
        parsed,
        structural,
        signature,
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'No se pudo analizar el XML del proveedor.',
      });
    }
  });

  app.post('/api/dgii/auth/test', async (req, res) => {
    try {
      const { organizationId, environment, endpoints, vaultKeyId, timeoutMs, maxRetries } = req.body ?? {};
      if (!organizationId || !environment || !vaultKeyId) {
        res.status(400).json({ ok: false, error: 'Faltan parámetros para probar autenticación DGII.' });
        return;
      }
      const envEndpoints = endpoints || OFFICIAL_DGII_ENV_ENDPOINTS[environment as keyof typeof OFFICIAL_DGII_ENV_ENDPOINTS];
      const result = await authenticateWithDgii({
        organizationId: String(organizationId),
        environment,
        endpoints: envEndpoints,
        vaultKeyId: String(vaultKeyId),
        timeoutMs: Number(timeoutMs) || 15000,
        maxRetries: Number(maxRetries) ?? 2,
        forceRefresh: true,
      });
      res.json({
        ok: true,
        expiresAtIso: result.expiresAtIso,
        isOfficialDgiiResponse: result.isOfficialDgiiResponse,
        message: result.message,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        isOfficialDgiiResponse: false,
        error: err instanceof Error ? err.message : 'Fallo autenticando con servicio DGII.',
      });
    }
  });

  app.post('/api/dgii/ecf/submit', async (req, res) => {
    try {
      const {
        organizationId,
        environment,
        endpoints,
        vaultKeyId,
        signedXml,
        fileName,
        isRfceSummary,
        timeoutMs,
        maxRetries,
      } = req.body ?? {};
      if (!organizationId || !environment || !signedXml) {
        res.status(400).json({ ok: false, error: 'Se requiere organizationId, environment y signedXml.' });
        return;
      }
      if (environment !== 'DESARROLLO' && !vaultKeyId) {
        res.status(400).json({ ok: false, error: 'Se requiere certificado digital activo (vaultKeyId) para enviar a DGII.' });
        return;
      }
      const envEndpoints = endpoints || OFFICIAL_DGII_ENV_ENDPOINTS[environment as keyof typeof OFFICIAL_DGII_ENV_ENDPOINTS];
      const result = await submitSignedEcfToDgii({
        organizationId: String(organizationId),
        environment,
        endpoints: envEndpoints,
        vaultKeyId: String(vaultKeyId || ''),
        signedXml: String(signedXml),
        fileName: String(fileName || 'ecf.xml'),
        isRfceSummary: Boolean(isRfceSummary),
        timeoutMs: Number(timeoutMs) || 15000,
        maxRetries: Number(maxRetries) ?? 2,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(502).json({
        ok: false,
        isOfficialDgiiResponse: false,
        error: err instanceof Error ? err.message : 'Error transmitiendo comprobante a DGII.',
      });
    }
  });

  app.post('/api/dgii/ecf/status', async (req, res) => {
    try {
      const { organizationId, environment, endpoints, vaultKeyId, trackId, timeoutMs, maxRetries } = req.body ?? {};
      if (!organizationId || !environment || !trackId) {
        res.status(400).json({ ok: false, error: 'Se requiere organizationId, environment y trackId.' });
        return;
      }
      const envEndpoints = endpoints || OFFICIAL_DGII_ENV_ENDPOINTS[environment as keyof typeof OFFICIAL_DGII_ENV_ENDPOINTS];
      const result = await queryDgiiTrackIdStatus({
        organizationId: String(organizationId),
        environment,
        endpoints: envEndpoints,
        vaultKeyId: String(vaultKeyId || ''),
        trackId: String(trackId),
        timeoutMs: Number(timeoutMs) || 15000,
        maxRetries: Number(maxRetries) ?? 2,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(502).json({
        ok: false,
        isOfficialDgiiResponse: false,
        error: err instanceof Error ? err.message : 'Error consultando TrackId en DGII.',
      });
    }
  });

  app.post('/api/dgii/ecf/commercial-approval', async (req, res) => {
    try {
      const { organizationId, environment, endpoints, vaultKeyId, xml, fileName, timeoutMs, maxRetries } = req.body ?? {};
      if (!organizationId || !environment || !vaultKeyId || !xml) {
        res.status(400).json({ ok: false, error: 'Se requiere organizationId, environment, vaultKeyId y xml.' });
        return;
      }
      const acecfCheck = validateEcfBeforeDigitalSignature(String(xml), 'ACECF');
      if (!acecfCheck.valid) {
        res.status(422).json({
          ok: false,
          error: `XML ACECF inválido contra ${acecfCheck.schemaFileName}: ${acecfCheck.errors.join(' | ')}`,
          validation: acecfCheck,
        });
        return;
      }
      const { privateKeyPem, certificatePem } = loadDecryptedCertificateFromVault({
        organizationId: String(organizationId),
        vaultKeyId: String(vaultKeyId),
      });
      const signed = signDgiiXmlEnveloped({ xml: String(xml), privateKeyPem, certificatePem });
      const envEndpoints = endpoints || OFFICIAL_DGII_ENV_ENDPOINTS[environment as keyof typeof OFFICIAL_DGII_ENV_ENDPOINTS];
      const dgiiResult = await sendSignedOperationToDgii({
        organizationId: String(organizationId),
        environment,
        endpoints: envEndpoints,
        vaultKeyId: String(vaultKeyId),
        targetUrl: envEndpoints.commercialApprovalUrl,
        signedXml: signed.signedXml,
        fileName: String(fileName || 'ACECF.xml'),
        timeoutMs: Number(timeoutMs) || 15000,
        maxRetries: Number(maxRetries) ?? 2,
      });
      res.json({ ok: true, signedXml: signed.signedXml, securityCode: signed.securityCode, dgiiResult });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error firmando/enviando aprobación comercial ACECF.',
      });
    }
  });

  app.post('/api/dgii/sequences/void', async (req, res) => {
    try {
      const { organizationId, environment, endpoints, vaultKeyId, xml, fileName, timeoutMs, maxRetries } = req.body ?? {};
      if (!organizationId || !environment || !xml) {
        res.status(400).json({ ok: false, error: 'Se requiere organizationId, environment y xml ANECF.' });
        return;
      }
      const anecfCheck = validateEcfBeforeDigitalSignature(String(xml), 'ANECF');
      if (!anecfCheck.valid) {
        res.status(422).json({
          ok: false,
          error: `XML ANECF inválido contra ${anecfCheck.schemaFileName}: ${anecfCheck.errors.join(' | ')}`,
          validation: anecfCheck,
        });
        return;
      }
      let signedXml = String(xml);
      if (vaultKeyId) {
        const { privateKeyPem, certificatePem } = loadDecryptedCertificateFromVault({
          organizationId: String(organizationId),
          vaultKeyId: String(vaultKeyId),
        });
        signedXml = signDgiiXmlEnveloped({ xml: signedXml, privateKeyPem, certificatePem }).signedXml;
      }
      const envEndpoints = endpoints || OFFICIAL_DGII_ENV_ENDPOINTS[environment as keyof typeof OFFICIAL_DGII_ENV_ENDPOINTS];
      const dgiiResult = await sendSignedOperationToDgii({
        organizationId: String(organizationId),
        environment,
        endpoints: envEndpoints,
        vaultKeyId: String(vaultKeyId || ''),
        targetUrl: envEndpoints.voidRangeUrl,
        signedXml,
        fileName: String(fileName || 'ANECF.xml'),
        timeoutMs: Number(timeoutMs) || 15000,
        maxRetries: Number(maxRetries) ?? 2,
      });
      res.json({ ok: true, signedXml, dgiiResult });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error procesando anulación ANECF.',
      });
    }
  });

  app.post('/api/dgii/service-status', async (req, res) => {
    try {
      const { serviceStatusUrl } = req.body ?? {};
      const target = String(serviceStatusUrl || OFFICIAL_DGII_ENV_ENDPOINTS.PRECERTIFICACION.serviceStatusUrl);
      const status = await checkDgiiServiceStatus(target);
      res.json({ ...status, ok: true });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'No se pudo consultar el estatus oficial de servicios DGII.',
      });
    }
  });

  // =========================================================================
  // AxyCore REGULA — Server-Side AI & Honest External Integrations Status
  // =========================================================================
  const assertRegulaServerAccess = (req: express.Request, res: express.Response): boolean => {
    const { organization, actorRole } = req.body ?? {};
    if (actorRole === 'EXTERNAL_CLIENT') {
      res.status(403).json({ error: 'Acceso denegado: clientes externos no pueden operar en AxyCore REGULA.' });
      return false;
    }
    if (organization) {
      const apiAccess = checkTenantApiAccess({ apiPath: '/api/regula', organization });
      if (!apiAccess.allowed) {
        res.status(403).json({ error: apiAccess.reason });
        return false;
      }
    }
    return true;
  };

  const handleRegulaAiError = (res: express.Response, err: unknown, fallbackMsg: string) => {
    const msg = err instanceof Error ? err.message : fallbackMsg;
    const status = msg.includes('GEMINI_API_KEY no está configurada')
      ? 503
      : msg.includes('Límite temporal')
      ? 429
      : msg.includes('tiempo máximo')
      ? 504
      : 502;
    console.error('REGULA AI Error:', err);
    res.status(status).json({ error: msg });
  };

  app.get('/api/regula/integrations-status', (_req, res) => {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const regulaAiConfigured = Boolean(geminiKey && geminiKey !== 'MY_GEMINI_API_KEY');
    const smtpConfigured = Boolean(
      process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()
    );
    const whatsappConfigured = Boolean(
      process.env.WHATSAPP_CLOUD_API_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
    );
    const regulatoryFeedConfigured = Boolean(process.env.REGULA_OFFICIAL_FEED_URL?.trim());
    const sanctionsApiConfigured = Boolean(process.env.REGULA_SANCTIONS_API_URL?.trim());
    res.json({
      regulaAiConfigured,
      model: 'gemini-4-hydrogen',
      smtpConfigured,
      whatsappConfigured,
      regulatoryFeedConfigured,
      sanctionsApiConfigured,
      regulatoryFeedNote: regulatoryFeedConfigured
        ? 'Fuente regulatoria configurada mediante variable de entorno.'
        : 'Requiere configuración de endpoint/credencial autorizada (REGULA_OFFICIAL_FEED_URL). No se simulan conexiones externas.',
      sanctionsApiNote: sanctionsApiConfigured
        ? 'Proveedor externo de listas restrictivas configurado.'
        : 'Requiere integración con proveedor autorizado (OFAC/ONU/listas locales vía REGULA_SANCTIONS_API_URL).',
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/regula/ai/assistant', async (req, res) => {
    if (!assertRegulaServerAccess(req, res)) return;
    try {
      const { question, regulaContext, actorId } = req.body ?? {};
      if (!question || typeof question !== 'string' || !question.trim()) {
        res.status(400).json({ error: 'Escribe una consulta válida para REGULA AI.' });
        return;
      }
      const result = await runRegulaAiAssistant({
        question: question.trim(),
        regulaContext: typeof regulaContext === 'object' && regulaContext ? regulaContext : {},
        actorId: typeof actorId === 'string' ? actorId : undefined,
      });
      res.json(result);
    } catch (err) {
      handleRegulaAiError(res, err, 'Error consultando al asistente REGULA AI.');
    }
  });

  app.post('/api/regula/ai/normative-analysis', async (req, res) => {
    if (!assertRegulaServerAccess(req, res)) return;
    try {
      const { normativeTitle, regulator, normativeText, institutionProfile, actorId } = req.body ?? {};
      if (!normativeText || typeof normativeText !== 'string' || normativeText.trim().length < 20) {
        res.status(400).json({ error: 'Proporciona el texto normativo completo o extracto (mínimo 20 caracteres).' });
        return;
      }
      const result = await runRegulaNormativeAnalysis({
        normativeTitle: String(normativeTitle || 'Normativa sin título'),
        regulator: String(regulator || 'Ente Regulador'),
        normativeText: normativeText.trim(),
        institutionProfile: typeof institutionProfile === 'object' ? institutionProfile : undefined,
        actorId: typeof actorId === 'string' ? actorId : undefined,
      });
      res.json(result);
    } catch (err) {
      handleRegulaAiError(res, err, 'Error ejecutando análisis normativo con REGULA AI.');
    }
  });

  app.post('/api/regula/ai/gap-diagnosis', async (req, res) => {
    if (!assertRegulaServerAccess(req, res)) return;
    try {
      const { focusArea, regulaContext, actorId } = req.body ?? {};
      const result = await runRegulaGapDiagnosis({
        focusArea: typeof focusArea === 'string' ? focusArea : undefined,
        regulaContext: typeof regulaContext === 'object' && regulaContext ? regulaContext : {},
        actorId: typeof actorId === 'string' ? actorId : undefined,
      });
      res.json(result);
    } catch (err) {
      handleRegulaAiError(res, err, 'Error ejecutando diagnóstico de brechas con REGULA AI.');
    }
  });

  app.post('/api/regula/ai/document-evaluation', async (req, res) => {
    if (!assertRegulaServerAccess(req, res)) return;
    try {
      const { documentTitle, documentType, documentText, actorId } = req.body ?? {};
      if (!documentText || typeof documentText !== 'string' || documentText.trim().length < 20) {
        res.status(400).json({ error: 'Proporciona el texto del documento a evaluar (mínimo 20 caracteres).' });
        return;
      }
      const result = await runRegulaDocumentEvaluation({
        documentTitle: String(documentTitle || 'Documento institucional'),
        documentType: String(documentType || 'POLITICA'),
        documentText: documentText.trim(),
        actorId: typeof actorId === 'string' ? actorId : undefined,
      });
      res.json(result);
    } catch (err) {
      handleRegulaAiError(res, err, 'Error evaluando documento con REGULA AI.');
    }
  });

  app.post('/api/regula/ai/generate-report', async (req, res) => {
    if (!assertRegulaServerAccess(req, res)) return;
    try {
      const { reportType, audience, regulaContext, actorId } = req.body ?? {};
      const result = await runRegulaReportDraft({
        reportType: String(reportType || 'Informe Ejecutivo de Cumplimiento y Riesgos'),
        audience: String(audience || 'Dirección General / Comité'),
        regulaContext: typeof regulaContext === 'object' && regulaContext ? regulaContext : {},
        actorId: typeof actorId === 'string' ? actorId : undefined,
      });
      res.json(result);
    } catch (err) {
      handleRegulaAiError(res, err, 'Error generando borrador de informe con REGULA AI.');
    }
  });

  // =========================================================================
  // One-Time Self-Cleaning Portfolio Remigration Handoff (Superadmin Only)
  // Cryptographically verifies Google Firebase Auth RS256 ID Token before
  // serving the extracted snapshot, and deletes the file upon completion.
  // =========================================================================
  const FIREBASE_PROJECT_ID = (() => {
    try {
      const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
      return parsed.projectId || 'future-bridge-skpm1';
    } catch {
      return 'future-bridge-skpm1';
    }
  })();

  const BOOTSTRAPPED_SUPERADMIN_EMAIL = 'andrygallardo7@gmail.com';
  const REMIGRATION_SNAPSHOT_PATH = path.resolve(
    __dirname,
    'server',
    'data',
    'su_gloria_remigration_v2.json'
  );

  let cachedFirebaseCerts: { certs: Record<string, string>; expiresAtMs: number } | null = null;

  const getGoogleFirebasePublicCerts = async (): Promise<Record<string, string>> => {
    if (cachedFirebaseCerts && Date.now() < cachedFirebaseCerts.expiresAtMs) {
      return cachedFirebaseCerts.certs;
    }
    const resp = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
    );
    if (!resp.ok) {
      throw new Error('No se pudieron obtener los certificados públicos de Firebase Auth.');
    }
    const certs = (await resp.json()) as Record<string, string>;
    const cc = resp.headers.get('cache-control') || '';
    const maxAgeMatch = cc.match(/max-age=(\d+)/i);
    const ttlMs = maxAgeMatch ? Math.min(3600, Number(maxAgeMatch[1])) * 1000 : 1800_000;
    cachedFirebaseCerts = { certs, expiresAtMs: Date.now() + ttlMs };
    return certs;
  };

  const verifySuperadminBearerToken = async (
    req: express.Request,
    res: express.Response
  ): Promise<{ uid: string; email: string } | null> => {
    try {
      const authHeader = String(req.headers.authorization || '');
      if (!authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Token de sesión requerido.' });
        return null;
      }
      const token = authHeader.slice(7).trim();
      const parts = token.split('.');
      if (parts.length !== 3) {
        res.status(401).json({ error: 'Formato de token inválido.' });
        return null;
      }
      const [headerB64, payloadB64, sigB64] = parts;
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as {
        alg?: string;
        kid?: string;
      };
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
        aud?: string;
        iss?: string;
        sub?: string;
        exp?: number;
        iat?: number;
        email?: string;
        email_verified?: boolean;
      };

      const nowSec = Math.floor(Date.now() / 1000);
      if (
        header.alg !== 'RS256' ||
        !header.kid ||
        payload.aud !== FIREBASE_PROJECT_ID ||
        payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
        !payload.sub ||
        typeof payload.exp !== 'number' ||
        payload.exp <= nowSec
      ) {
        res.status(401).json({ error: 'Token de sesión expirado o inválido.' });
        return null;
      }

      const certs = await getGoogleFirebasePublicCerts();
      const certPem = certs[header.kid];
      if (!certPem) {
        res.status(401).json({ error: 'Firma de token no reconocida.' });
        return null;
      }

      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(`${headerB64}.${payloadB64}`);
      verifier.end();
      const signatureValid = verifier.verify(certPem, Buffer.from(sigB64, 'base64url'));
      if (!signatureValid) {
        res.status(401).json({ error: 'Firma criptográfica del token inválida.' });
        return null;
      }

      const email = String(payload.email || '').toLowerCase();
      if (!payload.email_verified || email !== BOOTSTRAPPED_SUPERADMIN_EMAIL) {
        res.status(403).json({ error: 'Acceso restringido al Superadministrador principal.' });
        return null;
      }

      return { uid: payload.sub, email };
    } catch {
      res.status(401).json({ error: 'No se pudo verificar la sesión de Superadministrador.' });
      return null;
    }
  };

  app.get('/api/internal/su-gloria-remigration-bundle', async (req, res) => {
    const verified = await verifySuperadminBearerToken(req, res);
    if (!verified) return;
    if (!fs.existsSync(REMIGRATION_SNAPSHOT_PATH)) {
      res.json({ available: false });
      return;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(REMIGRATION_SNAPSHOT_PATH, 'utf8'));
      res.json({ available: true, ...raw });
    } catch {
      res.status(500).json({ error: 'No se pudo leer el paquete de re-migración.' });
    }
  });

  app.post('/api/internal/su-gloria-remigration-complete', async (req, res) => {
    const verified = await verifySuperadminBearerToken(req, res);
    if (!verified) return;
    try {
      if (fs.existsSync(REMIGRATION_SNAPSHOT_PATH)) {
        fs.unlinkSync(REMIGRATION_SNAPSHOT_PATH);
      }
      res.json({ cleaned: true });
    } catch {
      res.json({ cleaned: false });
    }
  });

  // Mount Vite middleware in dev or serve dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AxyCore server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start AxyCore server:', err);
  process.exit(1);
});
