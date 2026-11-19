import type {
  ApplicationRecord,
  ApprovalAuthorityRule,
  CommitteeDecisionRecord,
  CreditPolicyRecord,
  FormalizationRecord,
  RiskBandCode,
  UserRole,
} from '../types/axycore';

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  authorityUsed?: string;
}

export function normalizeRiskBandCode(raw?: string | null): RiskBandCode {
  const norm = String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^RIESGO_/, '');

  if (norm === 'MUY_BAJO' || norm === 'A' || norm === 'A+' || norm === 'A1') return 'MUY_BAJO';
  if (norm === 'BAJO' || norm === 'B' || norm === 'B+' || norm === 'A2') return 'BAJO';
  if (norm === 'MODERADO' || norm === 'MEDIO' || norm === 'C' || norm === 'B1') return 'MODERADO';
  if (norm === 'MEDIO_ALTO' || norm === 'D' || norm === 'C1') return 'MEDIO_ALTO';
  if (norm === 'ALTO' || norm === 'E' || norm === 'D1') return 'ALTO';
  if (norm === 'CRITICO' || norm === 'F' || norm === 'E1') return 'CRITICO';
  return 'ALTO';
}

export function canUserApproveCommittee(params: {
  userId: string;
  userRole: UserRole;
  application: Pick<ApplicationRecord, 'createdBy' | 'productCode' | 'latestRiskBand' | 'status'>;
  evaluation?: { analystId?: string | null } | null;
  proposedAmount: number;
  policy: CreditPolicyRecord;
}): PermissionCheckResult {
  const { userId, userRole, application, evaluation, proposedAmount, policy } = params;

  if (userRole !== 'ADMIN' && userRole !== 'COMMITTEE_MEMBER') {
    return {
      allowed: false,
      reason: `El rol ${userRole} no tiene facultad para emitir decisiones en Comité de Crédito.`,
    };
  }

  if (application.status !== 'EN_COMITE' && application.status !== 'EN_EVALUACION') {
    return {
      allowed: false,
      reason: `El expediente debe estar en Evaluación o Comité (estado actual: ${application.status}).`,
    };
  }

  // Separation of duties (Section 11)
  if (userRole !== 'ADMIN' && application.createdBy === userId) {
    return {
      allowed: false,
      reason: 'Conflicto de funciones: el usuario que originó la solicitud no puede aprobarla.',
    };
  }

  if (userRole !== 'ADMIN' && evaluation?.analystId && evaluation.analystId === userId) {
    return {
      allowed: false,
      reason: 'Conflicto de funciones: quien evaluó técnicamente el expediente no puede aprobarlo en Comité.',
    };
  }

  const activeRules = (policy.approvalAuthorities ?? []).filter((r: ApprovalAuthorityRule) => r.active);
  if (activeRules.length === 0) {
    // Section 11: "No inventar límites de facultades: deben configurarse por un administrador antes de utilizar el comité en producción."
    if (userRole === 'ADMIN') {
      return {
        allowed: true,
        authorityUsed: 'Facultad Administrativa (Pendiente de configurar matriz de facultades para producción)',
      };
    }
    return {
      allowed: false,
      reason:
        'No existen facultades de aprobación configuradas por un Administrador en la política vigente.',
    };
  }

  const bandCode = normalizeRiskBandCode(application.latestRiskBand);
  const matchingRule = activeRules.find(
    (r) =>
      r.role === userRole &&
      (r.productCode === 'ALL' || r.productCode === application.productCode) &&
      proposedAmount <= r.maxAmount &&
      r.allowedRiskBands.includes(bandCode)
  );

  if (!matchingRule) {
    return {
      allowed: false,
      reason: `El usuario (${userRole}) no posee facultad configurada para aprobar ${proposedAmount} en banda ${bandCode}.`,
    };
  }

  return {
    allowed: true,
    authorityUsed: `Regla ${matchingRule.id} (${userRole} hasta ${matchingRule.maxAmount.toLocaleString()})`,
  };
}

export function canExecuteDisbursement(params: {
  userRole: UserRole;
  application: Pick<ApplicationRecord, 'status'>;
  decision: Pick<CommitteeDecisionRecord, 'decision' | 'approvedAmount' | 'conditionsFulfilled'> | null;
  formalization: Pick<
    FormalizationRecord,
    'status' | 'approvedCapital' | 'legalReviewConfirmed' | 'conditionsFulfilled' | 'requiredDocsChecklist'
  > | null;
  existingDisbursementId: string | null;
}): PermissionCheckResult {
  const { userRole, application, decision, formalization, existingDisbursementId } = params;

  if (!['ADMIN', 'OPERATIONS', 'FINANCE'].includes(userRole)) {
    return {
      allowed: false,
      reason: `El rol ${userRole} no está autorizado para ejecutar desembolsos.`,
    };
  }

  if (existingDisbursementId || application.status === 'DESEMBOLSADA') {
    return {
      allowed: false,
      reason: 'Bloqueo de idempotencia: ya existe un desembolso registrado para esta operación.',
    };
  }

  if (!decision || !['APROBADO', 'APROBADO_CONDICIONADO'].includes(decision.decision)) {
    return {
      allowed: false,
      reason: 'Imposible desembolsar: no existe una aprobación vigente del Comité de Crédito.',
    };
  }

  if (decision.decision === 'APROBADO_CONDICIONADO' && !decision.conditionsFulfilled && !formalization?.conditionsFulfilled) {
    return {
      allowed: false,
      reason: 'Las condiciones previas de la aprobación condicionada aún no se han cumplido.',
    };
  }

  if (application.status !== 'FORMALIZADA' || !formalization || formalization.status !== 'LISTA_PARA_DESEMBOLSO') {
    return {
      allowed: false,
      reason: 'Imposible desembolsar: el expediente debe estar completamente formalizado.',
    };
  }

  const allDocsComplete = (formalization.requiredDocsChecklist ?? []).every((d) => d.completed);
  if (!allDocsComplete) {
    return {
      allowed: false,
      reason: 'Imposible desembolsar: existen documentos obligatorios pendientes en formalización.',
    };
  }

  if (
    decision.approvedAmount !== null &&
    decision.approvedAmount !== undefined &&
    Math.abs(formalization.approvedCapital - decision.approvedAmount) > 0.01
  ) {
    return {
      allowed: false,
      reason: 'El capital formalizado no coincide con el monto aprobado por el Comité.',
    };
  }

  return { allowed: true };
}

export interface CollegialVoteEntry {
  userId: string;
  userName: string;
  role: string;
  vote: CommitteeDecisionRecord['decision'] | string;
  votedAt: string;
}

export interface CollegialVoteEvaluation {
  uniqueVotes: CollegialVoteEntry[];
  totalVotes: number;
  approveCount: number;
  rejectCount: number;
  returnCount: number;
  requiredApprovals: number;
  panelSize: number;
  resolvedDecision: CommitteeDecisionRecord['decision'] | null;
  hasUserVoted: (uid: string) => boolean;
}

export function evaluateCollegialCommitteeVotes(
  votes: CollegialVoteEntry[],
  requiredApprovals = 2,
  panelSize = 3
): CollegialVoteEvaluation {
  const dedup = new Map<string, CollegialVoteEntry>();
  for (const v of votes) {
    if (!v.userId) continue;
    if (!dedup.has(v.userId)) {
      dedup.set(v.userId, v);
    }
  }
  const uniqueVotes = Array.from(dedup.values());
  const approveVotes = uniqueVotes.filter(
    (v) => v.vote === 'APROBADO' || v.vote === 'APROBADO_CONDICIONADO'
  );
  const rejectVotes = uniqueVotes.filter((v) => v.vote === 'RECHAZADO');
  const returnVotes = uniqueVotes.filter((v) => v.vote === 'DEVUELTO');

  let resolvedDecision: CommitteeDecisionRecord['decision'] | null = null;
  if (approveVotes.length >= requiredApprovals) {
    resolvedDecision = approveVotes.some((v) => v.vote === 'APROBADO_CONDICIONADO')
      ? 'APROBADO_CONDICIONADO'
      : 'APROBADO';
  } else if (rejectVotes.length >= requiredApprovals) {
    resolvedDecision = 'RECHAZADO';
  } else if (returnVotes.length >= requiredApprovals) {
    resolvedDecision = 'DEVUELTO';
  }

  return {
    uniqueVotes,
    totalVotes: uniqueVotes.length,
    approveCount: approveVotes.length,
    rejectCount: rejectVotes.length,
    returnCount: returnVotes.length,
    requiredApprovals,
    panelSize,
    resolvedDecision,
    hasUserVoted: (uid: string) => dedup.has(uid),
  };
}
