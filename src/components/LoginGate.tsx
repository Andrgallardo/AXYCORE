import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  MailCheck,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { authenticateWithBiometricCredential } from '../services/biometricAuth';
import type { PortalAccessMode } from '../types/axycore';

const REMEMBER_EMAIL_KEY = 'axycore_remember_email';

function mapFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  const msg = err instanceof Error ? err.message : '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Correo o contraseña incorrectos. Verifica tus credenciales o solicita restablecimiento.';
    case 'auth/invalid-email':
      return 'El formato del correo electrónico no es válido.';
    case 'auth/user-disabled':
      return 'Esta cuenta se encuentra deshabilitada. Contacta a Administración.';
    case 'auth/too-many-requests':
      return 'Se detectaron demasiados intentos fallidos. Espera unos minutos antes de intentar nuevamente.';
    case 'auth/email-already-in-use':
      return 'Este correo ya está registrado. Inicia sesión directamente, usa Google o presiona "Recuperar contraseña" para establecer una nueva clave.';
    case 'auth/weak-password':
      return 'La contraseña debe tener al menos 6 caracteres para proteger tu cuenta.';
    case 'auth/operation-not-allowed':
      return 'El acceso con correo y contraseña aún no está habilitado en Firebase Authentication. Usa "Continuar con cuenta Google" para ingresar automáticamente.';
    case 'auth/popup-closed-by-user':
      return 'Se cerró la ventana de autenticación antes de completar el acceso.';
    default:
      return msg || 'No fue posible validar tus credenciales en este momento.';
  }
}

const PORTAL_META: Record<
  PortalAccessMode,
  {
    title: string;
    subtitle: string;
    description: string;
    emailPlaceholder: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  axycore_admin: {
    title: 'Administrador de AxyCore',
    subtitle: 'Platform Control SaaS',
    description:
      'Consola exclusiva para gestión global de empresas, códigos corporativos, licencias y los 34 módulos SaaS.',
    emailPlaceholder: 'superadmin@axycore.com',
    icon: ShieldCheck,
  },
  corporate: {
    title: 'Acceso Corporativo',
    subtitle: 'Código de Empresa',
    description:
      'Ingreso operativo aislado para financieras y cooperativas afiliadas mediante su Código Corporativo asignado.',
    emailPlaceholder: 'colaborador@empresa.com',
    icon: Building2,
  },
  client: {
    title: 'Portal de Clientes',
    subtitle: 'Autogestión Financiera',
    description:
      'Revisa tus préstamos y calendario de cuotas, registra pagos y solicita renovaciones o nuevos créditos.',
    emailPlaceholder: 'cliente@correo.com',
    icon: Wallet,
  },
};

export function LoginGate() {
  const {
    firebaseUser,
    userProfile,
    organization,
    emailVerificationPending,
    signInWithEmail,
    registerWithEmail,
    signInWithGoogle,
    sendPasswordReset,
    resendVerificationEmail,
    reloadAuthUser,
    logout,
    setExternalPortalMode,
    portalMode,
    setPortalMode,
    pendingInviteLinkInfo,
    selectedCorporateCode,
    resolvedCorporateOrg,
    resolveCorporateAccessCode,
    clearCorporateAccessSelection,
    portalAccessError,
    clearPortalAccessError,
    biometricSupported,
    biometricLabel,
    biometricLocked,
    biometricSetupPending,
    lastBiometricCredential,
    enrollBiometrics,
    unlockWithBiometrics,
    dismissBiometricSetup,
    requestPostLoginBiometricSetup,
    forgetQuickBiometricDevice,
  } = useAxyCore();

  const [email, setEmail] = useState(() => {
    if (pendingInviteLinkInfo.email) return pendingInviteLinkInfo.email;
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(REMEMBER_EMAIL_KEY) || '';
  });
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.localStorage.getItem(REMEMBER_EMAIL_KEY));
  });
  const [enableBiometricsAfterLogin, setEnableBiometricsAfterLogin] = useState(true);

  const [corpCodeInput, setCorpCodeInput] = useState(
    pendingInviteLinkInfo.orgCode || selectedCorporateCode || ''
  );
  const [verifyingCorpCode, setVerifyingCorpCode] = useState(false);

  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(() =>
    pendingInviteLinkInfo.isInvitationLink ? 'register' : 'login'
  );
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [showFallbackUnlock, setShowFallbackUnlock] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockUntilMs, setLockUntilMs] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const passwordInputRef = useRef<HTMLInputElement>(null);
  const inviteAutoVerifiedRef = useRef<boolean>(false);

  useEffect(() => {
    if (selectedCorporateCode && !corpCodeInput) {
      setCorpCodeInput(selectedCorporateCode);
    }
  }, [selectedCorporateCode, corpCodeInput]);

  // Auto-verify corporate code when user opens a direct invitation link (?invite=...&orgCode=SGMA-001&email=...)
  useEffect(() => {
    if (
      !pendingInviteLinkInfo.isInvitationLink ||
      inviteAutoVerifiedRef.current ||
      resolvedCorporateOrg
    ) {
      return;
    }
    inviteAutoVerifiedRef.current = true;
    const code = pendingInviteLinkInfo.orgCode || 'SGMA-001';
    setCorpCodeInput(code);
    if (pendingInviteLinkInfo.email) {
      setEmail(pendingInviteLinkInfo.email);
    }
    void resolveCorporateAccessCode(code).then((res) => {
      if (res.ok && res.organization) {
        setSuccessMsg(
          `Invitación verificada para ${res.organization.tradeName || res.organization.name}. Activa tu cuenta con Google o correo/contraseña para ingresar automáticamente.`
        );
      }
    });
  }, [pendingInviteLinkInfo, resolvedCorporateOrg, resolveCorporateAccessCode]);

  useEffect(() => {
    if (!lockUntilMs) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockUntilMs - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        setLockUntilMs(null);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [lockUntilMs]);

  const selectPortal = (nextPortal: PortalAccessMode | null) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    clearPortalAccessError();
    setPortalMode(nextPortal);
    if (nextPortal === 'client') {
      setExternalPortalMode(true);
    } else {
      setExternalPortalMode(false);
    }
  };

  const handleRememberEmailChange = (checked: boolean) => {
    setRememberEmail(checked);
    if (typeof window !== 'undefined') {
      if (!checked) {
        window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
      } else if (email.trim()) {
        window.localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim());
      }
    }
  };

  const handleVerifyCorporateCode = async (overrideCode?: string) => {
    const codeToCheck = (overrideCode ?? corpCodeInput).trim();
    if (!codeToCheck) {
      setErrorMsg('Ingresa el Código Corporativo asignado a tu empresa.');
      return false;
    }
    setVerifyingCorpCode(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await resolveCorporateAccessCode(codeToCheck);
      if (!res.ok) {
        setErrorMsg(res.error || 'No pudimos validar ese Código Corporativo.');
        return false;
      }
      setCorpCodeInput(res.organization?.accessCode || codeToCheck.toUpperCase());
      setSuccessMsg(
        `Empresa verificada: ${res.organization?.tradeName || res.organization?.name}. Ahora inicia sesión con tu cuenta.`
      );
      return true;
    } finally {
      setVerifyingCorpCode(false);
    }
  };

  const ensureCorporateReady = async (): Promise<boolean> => {
    if (portalMode !== 'corporate') return true;
    if (resolvedCorporateOrg) return true;
    if (corpCodeInput.trim()) {
      return handleVerifyCorporateCode(corpCodeInput);
    }
    setErrorMsg('Verifica primero el Código Corporativo de tu empresa antes de iniciar sesión.');
    return false;
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockUntilMs && Date.now() < lockUntilMs) return;

    const corpReady = await ensureCorporateReady();
    if (!corpReady) return;

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMsg('Ingresa tu correo electrónico y contraseña.');
      return;
    }

    if (biometricSupported && !lastBiometricCredential) {
      requestPostLoginBiometricSetup(enableBiometricsAfterLogin);
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      if (typeof window !== 'undefined') {
        if (rememberEmail) {
          window.localStorage.setItem(REMEMBER_EMAIL_KEY, cleanEmail);
        } else {
          window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
        }
      }
      await signInWithEmail(cleanEmail, password);
      setFailedAttempts(0);
      setPassword('');
    } catch (err) {
      const nextFails = failedAttempts + 1;
      setFailedAttempts(nextFails);
      if (nextFails >= 5) {
        const cooldownMs = Math.min(120_000, 15_000 * Math.pow(2, nextFails - 5));
        setLockUntilMs(Date.now() + cooldownMs);
      }
      setErrorMsg(mapFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const corpReady = await ensureCorporateReady();
    if (!corpReady) return;

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Ingresa el correo electrónico autorizado en tu invitación.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Crea una contraseña segura de al menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Las contraseñas no coinciden. Verifícalas e intenta nuevamente.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await registerWithEmail({
        email: cleanEmail,
        password,
        displayName: fullName.trim() || undefined,
      });
      setPassword('');
      setConfirmPassword('');
      if (!res.emailVerified) {
        setSuccessMsg(
          res.verificationSent
            ? `Cuenta creada para ${cleanEmail}. Enviamos un correo de confirmación; al verificarlo entrarás automáticamente a tu empresa.`
            : `Cuenta creada para ${cleanEmail}. Confirma tu correo para activar tu acceso automático.`
        );
      }
    } catch (err) {
      setErrorMsg(mapFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async (loginHint?: string) => {
    const corpReady = await ensureCorporateReady();
    if (!corpReady) return;

    if (biometricSupported && !lastBiometricCredential) {
      requestPostLoginBiometricSetup(enableBiometricsAfterLogin);
    }

    setGoogleLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await signInWithGoogle(loginHint || (email.trim() || undefined));
    } catch (err) {
      setErrorMsg(mapFirebaseAuthError(err));
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleQuickBiometricPreLogin = async () => {
    if (!lastBiometricCredential) return;
    const corpReady = await ensureCorporateReady();
    if (!corpReady) return;

    setBioLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const result = await authenticateWithBiometricCredential(
        lastBiometricCredential.uid
      );
      if (!result.ok) {
        setErrorMsg(
          result.error || `No fue posible validar ${biometricLabel} en este dispositivo.`
        );
        return;
      }

      setEmail(lastBiometricCredential.email);
      if (lastBiometricCredential.providerId === 'google.com') {
        setSuccessMsg(
          `Identidad biométrica verificada (${biometricLabel}). Conectando sesión federada...`
        );
        await signInWithGoogle(lastBiometricCredential.email);
      } else {
        setSuccessMsg(
          `Identidad biométrica verificada (${biometricLabel}) para ${lastBiometricCredential.email}. Confirma tu contraseña con el llavero del dispositivo para ingresar.`
        );
        window.setTimeout(() => passwordInputRef.current?.focus(), 60);
      }
    } catch (err) {
      setErrorMsg(mapFirebaseAuthError(err));
    } finally {
      setBioLoading(false);
    }
  };

  const handleBiometricUnlock = async () => {
    setBioLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await unlockWithBiometrics();
      if (!res.ok) {
        setErrorMsg(
          res.error || `No pudimos validar ${biometricLabel}. Puedes usar tu contraseña o Google.`
        );
      }
    } finally {
      setBioLoading(false);
    }
  };

  const handleEnrollBiometricsNow = async () => {
    setBioLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await enrollBiometrics();
      if (!res.ok) {
        setErrorMsg(res.error || `No pudimos activar ${biometricLabel} en este dispositivo.`);
      }
    } finally {
      setBioLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMsg('Ingresa tu correo electrónico para recibir el enlace de recuperación.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await sendPasswordReset(cleanEmail);
      setSuccessMsg(
        'Si el correo existe en AxyCore, recibirás instrucciones para restablecer tu contraseña de forma segura.'
      );
    } catch (err) {
      setErrorMsg(mapFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await resendVerificationEmail();
      setSuccessMsg('Correo de verificación reenviado. Revisa tu bandeja de entrada o spam.');
    } catch (err) {
      setErrorMsg(mapFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCheckVerified = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await reloadAuthUser();
      if (firebaseUser && !firebaseUser.emailVerified) {
        setErrorMsg(
          'El correo aún figura como no verificado. Abre el enlace en tu correo y vuelve a intentar.'
        );
      }
    } catch (err) {
      setErrorMsg(mapFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const isMobileSelectorStage =
    !emailVerificationPending &&
    !biometricLocked &&
    !biometricSetupPending &&
    !(firebaseUser && portalAccessError) &&
    portalMode === null;

  const activePortalMeta = portalMode ? PORTAL_META[portalMode] : null;
  const ActivePortalIcon = activePortalMeta?.icon || ShieldCheck;

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#030816] text-slate-100 flex flex-col justify-between p-4 sm:p-8">
      {/* Technological AxyCore ambient field: Cobalt, Infinity Cyan, and subtle Champagne Gold */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(0,102,255,0.24),transparent_52%),radial-gradient(ellipse_at_bottom_right,rgba(0,184,255,0.16),transparent_50%),radial-gradient(circle_at_75%_20%,rgba(226,179,94,0.06),transparent_40%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-[0.055]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(0,184,255,0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,184,255,0.4) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Top institutional bar */}
      <header className="relative z-10 w-full max-w-6xl mx-auto flex items-center justify-between gap-4 py-1">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-white p-1.5 shadow-[0_0_20px_-4px_rgba(0,184,255,0.45)] ring-1 ring-[#00B8FF]/30 flex items-center justify-center shrink-0">
            <img
              src="/assets/aistudio/image_aea21874.png"
              alt="AxyCore"
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <span className="font-display text-base font-extrabold tracking-tight text-white block leading-tight">
              Axy<span className="axy-wordmark-core">Core</span>
            </span>
            <span className="text-[11px] text-slate-400 hidden sm:block">
              Ecosistema Financiero Multi-Tenant
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {portalMode !== null && !biometricLocked && !biometricSetupPending && (
            <button
              type="button"
              onClick={() => selectPortal(null)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#00B8FF]/25 bg-[#071430]/75 hover:bg-[#0B1E47] hover:border-[#00B8FF]/45 text-xs font-semibold text-slate-100 transition-all cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-[#00B8FF]" />
              <span>Cambiar portal</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Centered Container */}
      <main className="relative z-10 flex-1 flex items-center justify-center py-6 sm:py-8">
        {/* STAGE 0: PRE-LOGIN 3-PORTAL ENTRY SELECTOR */}
        {isMobileSelectorStage ? (
          <div className="axy-panel-in w-full max-w-5xl space-y-8">
            <div className="text-center space-y-3">
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-white shadow-[0_14px_40px_-8px_rgba(0,102,255,0.55),0_0_24px_-6px_rgba(0,184,255,0.35)] ring-1 ring-[#00B8FF]/35 p-2.5 mx-auto">
                <img
                  src="/assets/aistudio/image_aea21874.png"
                  alt="Logotipo AxyCore"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-contain"
                />
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                Bienvenido a Axy<span className="axy-wordmark-core">Core</span>
              </h1>
              <p className="text-sm text-slate-300/90 max-w-xl mx-auto leading-relaxed">
                Selecciona el portal correspondiente a tu perfil para acceder de forma segura a la plataforma.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* 1. Administrador de AxyCore */}
              <button
                type="button"
                onClick={() => selectPortal('axycore_admin')}
                className="group relative text-left overflow-hidden rounded-2xl bg-[#07122B]/92 backdrop-blur-2xl border border-[#00B8FF]/20 hover:border-[#E2B35E]/60 p-6 sm:p-7 flex flex-col justify-between gap-6 transition-all shadow-[0_24px_60px_-15px_rgba(0,0,0,0.75)] hover:-translate-y-0.5 cursor-pointer"
              >
                <div
                  aria-hidden="true"
                  className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-[#E2B35E] to-transparent opacity-80"
                />
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="h-12 w-12 rounded-xl bg-[#E2B35E]/15 border border-[#E2B35E]/35 text-[#E2B35E] flex items-center justify-center">
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                    <span className="text-[11px] font-mono font-semibold text-[#E2B35E]">
                      SuperAdmin SaaS
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="font-display text-lg font-bold text-white group-hover:text-[#E2B35E] transition-colors">
                      Administrador de AxyCore
                    </h2>
                    <p className="text-xs font-semibold text-[#00D1FF]">
                      Platform Control SaaS
                    </p>
                    <p className="text-xs text-slate-300/90 leading-relaxed pt-1">
                      Gobierno global de empresas afiliadas, licencias comerciales, códigos corporativos y activación de los 34 módulos.
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10 flex items-center justify-between text-xs font-semibold text-white">
                  <span>Entrar a Platform Control</span>
                  <ArrowRight className="w-4 h-4 text-[#E2B35E] group-hover:translate-x-1 transition-transform" />
                </div>
              </button>

              {/* 2. Acceso Corporativo */}
              <button
                type="button"
                onClick={() => selectPortal('corporate')}
                className="group relative text-left overflow-hidden rounded-2xl bg-[#07122B]/92 backdrop-blur-2xl border border-[#00B8FF]/30 hover:border-[#00D1FF] p-6 sm:p-7 flex flex-col justify-between gap-6 transition-all shadow-[0_24px_60px_-15px_rgba(0,0,0,0.8),0_0_32px_-12px_rgba(0,102,255,0.3)] hover:-translate-y-0.5 cursor-pointer"
              >
                <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-infinity-line" />
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="h-12 w-12 rounded-xl bg-[#0066FF]/20 border border-[#00B8FF]/40 text-[#00D1FF] flex items-center justify-center">
                      <Building2 className="w-6 h-6" />
                    </div>
                    <span className="text-[11px] font-mono font-semibold text-[#00D1FF]">
                      Código de Empresa
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="font-display text-lg font-bold text-white group-hover:text-[#00D1FF] transition-colors">
                      Acceso Corporativo
                    </h2>
                    <p className="text-xs font-semibold text-[#00D1FF]">
                      Instituciones y Equipos Afiliados
                    </p>
                    <p className="text-xs text-slate-300/90 leading-relaxed pt-1">
                      Ingresa con el código único asignado a tu empresa para operar originación, comité, desembolsos y cobranza.
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10 flex items-center justify-between text-xs font-semibold text-white">
                  <span>Ingresar con código corporativo</span>
                  <ArrowRight className="w-4 h-4 text-[#00D1FF] group-hover:translate-x-1 transition-transform" />
                </div>
              </button>

              {/* 3. Portal de Clientes */}
              <button
                type="button"
                onClick={() => selectPortal('client')}
                className="group relative text-left overflow-hidden rounded-2xl bg-[#07122B]/92 backdrop-blur-2xl border border-[#00B8FF]/20 hover:border-emerald-400/60 p-6 sm:p-7 flex flex-col justify-between gap-6 transition-all shadow-[0_24px_60px_-15px_rgba(0,0,0,0.75)] hover:-translate-y-0.5 cursor-pointer"
              >
                <div
                  aria-hidden="true"
                  className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent opacity-80"
                />
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="h-12 w-12 rounded-xl bg-emerald-500/15 border border-emerald-400/35 text-emerald-400 flex items-center justify-center">
                      <Wallet className="w-6 h-6" />
                    </div>
                    <span className="text-[11px] font-mono font-semibold text-emerald-400">
                      Autogestión 24/7
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="font-display text-lg font-bold text-white group-hover:text-emerald-300 transition-colors">
                      Portal de Clientes
                    </h2>
                    <p className="text-xs font-semibold text-emerald-400">
                      Préstamos, Pagos y Renovaciones
                    </p>
                    <p className="text-xs text-slate-300/90 leading-relaxed pt-1">
                      Consulta tus préstamos activos y calendario de cuotas, registra pagos realizados y solicita renovaciones.
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10 flex items-center justify-between text-xs font-semibold text-white">
                  <span>Acceder como cliente</span>
                  <ArrowRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#00B8FF]" />
                Aislamiento estricto por organización
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <ScanFace className="w-3.5 h-3.5 text-[#00D1FF]" />
                Compatible con {biometricLabel}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-[#E2B35E]" />
                Firebase Auth &amp; WebAuthn
              </span>
            </div>
          </div>
        ) : (
          /* AUTH / BIOMETRIC / VERIFICATION CARD */
          <div className="axy-panel-in w-full max-w-[460px]">
            <div className="text-center mb-6 space-y-2">
              <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-white shadow-[0_14px_40px_-8px_rgba(0,102,255,0.55),0_0_24px_-6px_rgba(0,184,255,0.35)] ring-1 ring-[#00B8FF]/35 p-2 mx-auto">
                <img
                  src="/assets/aistudio/image_aea21874.png"
                  alt="Logotipo AxyCore"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-contain"
                />
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                Axy<span className="axy-wordmark-core">Core</span>
              </h1>
            </div>

            <div className="relative overflow-hidden rounded-2xl bg-[#07122B]/92 backdrop-blur-2xl border border-[#00B8FF]/20 shadow-[0_28px_80px_-15px_rgba(0,0,0,0.85),0_0_40px_-15px_rgba(0,102,255,0.25)] p-6 sm:p-8 space-y-5">
              <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-infinity-line" />

              {/* 1. EMAIL VERIFICATION PENDING */}
              {emailVerificationPending && firebaseUser ? (
                <div className="space-y-5">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-[#E2B35E]/15 border border-[#E2B35E]/35 text-[#E2B35E] shrink-0">
                      <MailCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-display text-lg font-bold text-white">
                        Verifica tu correo
                      </h2>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        Para proteger la seguridad de tus operaciones, AxyCore requiere verificar{' '}
                        <span className="font-semibold text-white">{firebaseUser.email}</span> antes
                        de acceder al espacio de trabajo.
                      </p>
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="p-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-200 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  {successMsg && (
                    <div className="p-3 rounded-xl border border-[#00B8FF]/35 bg-[#00B8FF]/10 text-xs text-sky-200 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#00B8FF]" />
                      <span>{successMsg}</span>
                    </div>
                  )}

                  <div className="space-y-2.5">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleCheckVerified}
                      className="w-full py-2.5 px-4 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                      <span>Ya verifiqué mi correo</span>
                    </button>

                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleResendVerification}
                      className="w-full py-2.5 px-4 rounded-xl border border-[#00B8FF]/20 bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Reenviar correo de verificación
                    </button>

                    <button
                      type="button"
                      onClick={logout}
                      className="w-full py-2 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                      Cerrar sesión e intentar con otra cuenta
                    </button>
                  </div>
                </div>
              ) : /* 2. BIOMETRIC LOCK SCREEN */
              biometricLocked && firebaseUser && userProfile ? (
                <div className="space-y-5 text-center">
                  <div className="mx-auto relative w-20 h-20 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full border-2 border-[#00B8FF]/30" />
                    <div className="absolute inset-2 rounded-full border border-[#00D1FF]/45" />
                    <div className="h-12 w-12 rounded-2xl bg-[#0066FF]/20 border border-[#00B8FF]/40 text-[#00D1FF] flex items-center justify-center">
                      {/Android|Huella/i.test(biometricLabel) ? (
                        <Fingerprint className="w-6 h-6" />
                      ) : (
                        <ScanFace className="w-6 h-6" />
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <h2 className="font-display text-lg font-bold text-white">
                      Sesión protegida con {biometricLabel}
                    </h2>
                    <p className="text-xs text-slate-300">
                      {userProfile.displayName} ·{' '}
                      <span className="text-[#00D1FF] font-mono">{userProfile.email}</span>
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Espacio: {organization.tradeName || organization.name}
                    </p>
                  </div>

                  {errorMsg && (
                    <div className="p-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-200 flex items-start gap-2 text-left">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={bioLoading}
                    onClick={handleBiometricUnlock}
                    className="w-full py-3 px-4 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-[0_10px_28px_-6px_rgba(0,102,255,0.65)]"
                  >
                    <ScanFace className="w-4 h-4" />
                    <span>
                      {bioLoading
                        ? `Verificando ${biometricLabel}...`
                        : `Desbloquear con ${biometricLabel}`}
                    </span>
                  </button>

                  {!showFallbackUnlock ? (
                    <button
                      type="button"
                      onClick={() => setShowFallbackUnlock(true)}
                      className="text-xs text-[#00B8FF] hover:text-sky-300 transition-colors cursor-pointer"
                    >
                      ¿Problemas con {biometricLabel}? Verificar con otra vía
                    </button>
                  ) : (
                    <div className="pt-2 border-t border-white/10 space-y-2.5 text-left">
                      <p className="text-[11px] text-slate-400">
                        Si tu dispositivo cambió de sensor biométrico, puedes cerrar esta sesión e ingresar con Google o tu contraseña.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleGoogleLogin(userProfile.email)}
                        disabled={googleLoading}
                        className="w-full py-2 px-3 rounded-xl border border-[#00B8FF]/25 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Globe className="w-3.5 h-3.5 text-[#00B8FF]" />
                        <span>Re-autenticar con Google</span>
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={logout}
                    className="w-full inline-flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Cerrar sesión e iniciar con otra cuenta</span>
                  </button>
                </div>
              ) : /* 3. POST-LOGIN 1-TAP BIOMETRIC ENROLLMENT */
              biometricSetupPending && firebaseUser && userProfile ? (
                <div className="space-y-5">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-[#0066FF]/20 border border-[#00B8FF]/35 text-[#00D1FF] shrink-0">
                      <ScanFace className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-display text-lg font-bold text-white">
                        Activa {biometricLabel} en este dispositivo
                      </h2>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        Vincula una clave criptográfica WebAuthn protegida por el chip seguro de tu móvil o equipo para bloquear y desbloquear AxyCore en un toque, sin guardar contraseñas.
                      </p>
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="p-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-200 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  <div className="p-3.5 rounded-xl bg-[#040C1E]/85 border border-[#00B8FF]/15 text-xs space-y-1">
                    <p className="font-semibold text-white">{userProfile.displayName}</p>
                    <p className="text-slate-400 font-mono text-[11px]">{userProfile.email}</p>
                  </div>

                  <div className="space-y-2.5">
                    <button
                      type="button"
                      disabled={bioLoading}
                      onClick={handleEnrollBiometricsNow}
                      className="w-full py-2.5 px-4 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <Fingerprint className="w-4 h-4" />
                      <span>
                        {bioLoading ? `Configurando ${biometricLabel}...` : `Activar ${biometricLabel} ahora`}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={dismissBiometricSetup}
                      className="w-full py-2.5 px-4 rounded-xl border border-white/10 hover:bg-white/[0.05] text-slate-300 text-xs font-medium transition-colors cursor-pointer"
                    >
                      Omitir por ahora
                    </button>
                  </div>
                </div>
              ) : /* 4. PORTAL ACCESS ERROR */
              firebaseUser && portalAccessError ? (
                <div className="space-y-5">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/35 text-rose-400 shrink-0">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-display text-lg font-bold text-white">
                        Acceso no autorizado en este portal
                      </h2>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        {portalAccessError}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() => selectPortal('corporate')}
                      className="w-full py-2.5 px-4 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Building2 className="w-4 h-4" />
                      <span>Cambiar a Acceso Corporativo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => selectPortal('client')}
                      className="w-full py-2.5 px-4 rounded-xl border border-[#00B8FF]/25 bg-white/[0.04] hover:bg-white/[0.08] text-slate-100 text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Wallet className="w-4 h-4 text-emerald-400" />
                      <span>Cambiar a Portal de Clientes</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => selectPortal('axycore_admin')}
                      className="w-full py-2.5 px-4 rounded-xl border border-[#E2B35E]/30 bg-white/[0.03] hover:bg-white/[0.07] text-[#E2B35E] text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Ir a Administrador de AxyCore</span>
                    </button>

                    <button
                      type="button"
                      onClick={logout}
                      className="w-full py-2 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                      Cerrar sesión e iniciar con otra cuenta
                    </button>
                  </div>
                </div>
              ) : /* 5. PASSWORD RESET MODE */
              mode === 'reset' ? (
                <form onSubmit={handleResetPassword} className="space-y-5">
                  <div className="space-y-1">
                    <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-[#00B8FF]" />
                      Recuperar contraseña
                    </h2>
                    <p className="text-xs text-slate-400">
                      Ingresa tu correo para recibir un enlace seguro de restablecimiento.
                    </p>
                  </div>

                  {errorMsg && (
                    <div className="p-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-200 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  {successMsg && (
                    <div className="p-3 rounded-xl border border-[#00B8FF]/35 bg-[#00B8FF]/10 text-xs text-sky-200 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#00B8FF]" />
                      <span>{successMsg}</span>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="reset-email"
                      className="block text-xs font-medium text-slate-300 mb-1.5"
                    >
                      Correo electrónico
                    </label>
                    <input
                      id="reset-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={activePortalMeta?.emailPlaceholder || 'nombre@empresa.com'}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#030816]/85 border border-[#00B8FF]/20 text-sm text-white placeholder:text-slate-500 focus:border-[#00B8FF] focus:outline-none transition-colors"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
                  >
                    {loading ? 'Enviando enlace...' : 'Enviar enlace de recuperación'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setErrorMsg(null);
                      setSuccessMsg(null);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Volver al inicio de sesión
                  </button>
                </form>
              ) : (
                /* 6. PORTAL-SPECIFIC LOGIN FORM */
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 rounded-xl bg-[#0066FF]/15 border border-[#00B8FF]/30 text-[#00D1FF] shrink-0">
                        <ActivePortalIcon className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="font-display text-lg font-bold tracking-tight text-white">
                          {activePortalMeta?.title || 'Iniciar sesión'}
                        </h2>
                        <p className="text-xs text-[#00D1FF] font-semibold">
                          {activePortalMeta?.subtitle}
                        </p>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    {activePortalMeta?.description}
                  </p>

                  {/* CORPORATE ACCESS CODE VERIFICATION BLOCK */}
                  {portalMode === 'corporate' && (
                    <div className="p-4 rounded-xl bg-[#040C1E]/90 border border-[#00B8FF]/25 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="corporate-access-code"
                          className="text-xs font-semibold text-white"
                        >
                          Código Corporativo de Empresa *
                        </label>
                        {!resolvedCorporateOrg && (
                          <button
                            type="button"
                            onClick={() => {
                              setCorpCodeInput('SGMA-001');
                              handleVerifyCorporateCode('SGMA-001');
                            }}
                            className="text-[11px] font-mono text-[#00D1FF] hover:underline cursor-pointer"
                          >
                            Principal: SGMA-001
                          </button>
                        )}
                      </div>

                      {resolvedCorporateOrg ? (
                        <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-400/30">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span className="truncate">
                                {resolvedCorporateOrg.tradeName || resolvedCorporateOrg.name}
                              </span>
                            </p>
                            <p className="text-[11px] font-mono text-emerald-300 mt-0.5">
                              Código: {resolvedCorporateOrg.accessCode} · Plan{' '}
                              {resolvedCorporateOrg.planCode || 'CORPORATIVO'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              clearCorporateAccessSelection();
                              setSuccessMsg(null);
                            }}
                            className="text-[11px] font-semibold text-slate-300 hover:text-white underline shrink-0 cursor-pointer"
                          >
                            Cambiar
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            id="corporate-access-code"
                            type="text"
                            value={corpCodeInput}
                            onChange={(e) => setCorpCodeInput(e.target.value.toUpperCase())}
                            placeholder="EJ. SGMA-001"
                            className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-[#030816] border border-[#00B8FF]/25 text-xs font-mono uppercase tracking-wider text-white placeholder:text-slate-500 focus:border-[#00B8FF] focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={verifyingCorpCode || !corpCodeInput.trim()}
                            onClick={() => handleVerifyCorporateCode()}
                            className="px-3.5 py-2 rounded-xl bg-[#0066FF]/25 hover:bg-[#0066FF]/40 border border-[#00B8FF]/40 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            {verifyingCorpCode ? 'Validando...' : 'Verificar'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {errorMsg && (
                    <div className="p-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-200 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  {successMsg && (
                    <div className="p-3 rounded-xl border border-[#00B8FF]/35 bg-[#00B8FF]/10 text-xs text-sky-200 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#00B8FF]" />
                      <span>{successMsg}</span>
                    </div>
                  )}

                  {secondsLeft > 0 && (
                    <div className="p-3 rounded-xl border border-[#E2B35E]/35 bg-[#E2B35E]/10 text-xs text-amber-200 font-mono tabular-nums">
                      Bloqueo temporal preventivo por intentos fallidos. Espera {secondsLeft}s.
                    </div>
                  )}

                  {/* QUICK BIOMETRIC PRE-LOGIN TRIGGER */}
                  {biometricSupported && lastBiometricCredential && (
                    <div className="p-3.5 rounded-xl bg-[#040C1E]/85 border border-[#00B8FF]/25 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white flex items-center gap-1.5">
                            <UserCheck className="w-3.5 h-3.5 text-[#00D1FF] shrink-0" />
                            <span className="truncate">{lastBiometricCredential.displayName}</span>
                          </p>
                          <p className="text-[11px] font-mono text-slate-400 truncate">
                            {lastBiometricCredential.email}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => forgetQuickBiometricDevice(lastBiometricCredential.uid)}
                          className="text-[11px] text-slate-400 hover:text-rose-300 cursor-pointer shrink-0"
                        >
                          Olvidar
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={bioLoading || googleLoading || loading}
                        onClick={handleQuickBiometricPreLogin}
                        className="w-full py-2 px-3 rounded-xl bg-[#0066FF]/20 hover:bg-[#0066FF]/35 border border-[#00B8FF]/40 text-xs font-semibold text-[#00D1FF] flex items-center justify-center gap-2 cursor-pointer transition-colors"
                      >
                        <ScanFace className="w-4 h-4" />
                        <span>
                          {bioLoading
                            ? `Validando ${biometricLabel}...`
                            : `Acceso rápido con ${biometricLabel}`}
                        </span>
                      </button>
                    </div>
                  )}

                  {pendingInviteLinkInfo.isInvitationLink && (
                    <div className="p-3.5 rounded-xl bg-emerald-500/12 border border-emerald-400/35 text-xs text-emerald-100 space-y-1">
                      <p className="font-semibold text-emerald-300 flex items-center gap-1.5">
                        <UserPlus className="w-4 h-4 shrink-0" />
                        <span>Invitación Corporativa Activa</span>
                      </p>
                      <p className="text-[11px] text-emerald-100/90 leading-relaxed">
                        Inicia sesión con Google usando tu correo invitado para activar tu rol y acceder automáticamente, o crea tu contraseña personal abajo.
                      </p>
                    </div>
                  )}

                  {portalMode !== 'axycore_admin' && (
                    <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#030816]/90 border border-[#00B8FF]/20">
                      <button
                        type="button"
                        onClick={() => {
                          setMode('login');
                          setErrorMsg(null);
                        }}
                        className={`py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                          mode === 'login'
                            ? 'axy-brand-gradient text-white shadow-sm'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Iniciar sesión
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMode('register');
                          setErrorMsg(null);
                        }}
                        className={`py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                          mode === 'register'
                            ? 'axy-brand-gradient text-white shadow-sm'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Activar invitación / Registro
                      </button>
                    </div>
                  )}

                  {mode === 'register' ? (
                    <div className="space-y-4">
                      <button
                        type="button"
                        disabled={googleLoading || loading}
                        onClick={() => handleGoogleLogin(email.trim() || undefined)}
                        className="w-full py-3 px-4 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold shadow-[0_10px_28px_-6px_rgba(0,102,255,0.65)] transition-all disabled:opacity-50 flex items-center justify-center gap-2.5 cursor-pointer"
                      >
                        <Globe className="w-4 h-4" />
                        <span>
                          {googleLoading
                            ? 'Activando acceso con Google...'
                            : 'Activar cuenta y entrar con Google (Inmediato)'}
                        </span>
                      </button>

                      <div className="relative flex items-center py-0.5">
                        <div className="flex-1 border-t border-white/10" />
                        <span className="px-3 text-[11px] text-slate-400">o crear contraseña con correo</span>
                        <div className="flex-1 border-t border-white/10" />
                      </div>

                      <form onSubmit={handleEmailRegister} className="space-y-3.5">
                        <div>
                          <label
                            htmlFor="register-name"
                            className="block text-xs font-medium text-slate-300 mb-1"
                          >
                            Nombre completo
                          </label>
                          <input
                            id="register-name"
                            type="text"
                            autoComplete="name"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="Tu nombre y apellido"
                            className="w-full px-3.5 py-2.5 rounded-xl bg-[#030816]/85 border border-[#00B8FF]/20 text-sm text-white placeholder:text-slate-500 focus:border-[#00B8FF] focus:outline-none transition-colors"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="register-email"
                            className="block text-xs font-medium text-slate-300 mb-1"
                          >
                            Correo autorizado *
                          </label>
                          <input
                            id="register-email"
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder={activePortalMeta?.emailPlaceholder || 'correo@empresa.com'}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-[#030816]/85 border border-[#00B8FF]/20 text-sm text-white placeholder:text-slate-500 focus:border-[#00B8FF] focus:outline-none transition-colors"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="register-password"
                            className="block text-xs font-medium text-slate-300 mb-1"
                          >
                            Nueva contraseña *
                          </label>
                          <input
                            id="register-password"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            required
                            minLength={6}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Mínimo 6 caracteres"
                            className="w-full px-3.5 py-2.5 rounded-xl bg-[#030816]/85 border border-[#00B8FF]/20 text-sm text-white placeholder:text-slate-500 focus:border-[#00B8FF] focus:outline-none transition-colors"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="register-confirm-password"
                            className="block text-xs font-medium text-slate-300 mb-1"
                          >
                            Confirmar contraseña *
                          </label>
                          <input
                            id="register-confirm-password"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            required
                            minLength={6}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Repite tu contraseña"
                            className="w-full px-3.5 py-2.5 rounded-xl bg-[#030816]/85 border border-[#00B8FF]/20 text-sm text-white placeholder:text-slate-500 focus:border-[#00B8FF] focus:outline-none transition-colors"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full py-2.5 px-4 rounded-xl border border-[#00B8FF]/35 bg-[#0066FF]/20 hover:bg-[#0066FF]/35 text-white font-semibold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <UserPlus className="w-4 h-4" />
                          <span>{loading ? 'Creando cuenta...' : 'Registrarme y activar acceso'}</span>
                        </button>
                      </form>
                    </div>
                  ) : (
                    <>
                      <form onSubmit={handleEmailLogin} className="space-y-4">
                        <div>
                          <label
                            htmlFor="login-email"
                            className="block text-xs font-medium text-slate-300 mb-1.5"
                          >
                            Correo electrónico
                          </label>
                          <input
                            id="login-email"
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder={activePortalMeta?.emailPlaceholder || 'correo@empresa.com'}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-[#030816]/85 border border-[#00B8FF]/20 text-sm text-white placeholder:text-slate-500 focus:border-[#00B8FF] focus:outline-none transition-colors"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label
                              htmlFor="login-password"
                              className="block text-xs font-medium text-slate-300"
                            >
                              Contraseña
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                setMode('reset');
                                setErrorMsg(null);
                                setSuccessMsg(null);
                              }}
                              className="text-xs text-[#00B8FF] hover:text-sky-300 transition-colors cursor-pointer"
                            >
                              Recuperar contraseña
                            </button>
                          </div>
                          <div className="relative">
                            <input
                              ref={passwordInputRef}
                              id="login-password"
                              type={showPassword ? 'text' : 'password'}
                              autoComplete="current-password"
                              required
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="••••••••••••"
                              className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-[#030816]/85 border border-[#00B8FF]/20 text-sm text-white placeholder:text-slate-500 focus:border-[#00B8FF] focus:outline-none transition-colors"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((prev) => !prev)}
                              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
                            >
                              {showPassword ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-xs text-slate-300 select-none cursor-pointer">
                            <input
                              type="checkbox"
                              checked={rememberEmail}
                              onChange={(e) => handleRememberEmailChange(e.target.checked)}
                              className="rounded border-[#00B8FF]/30 bg-[#030816] text-[#0066FF] focus:ring-[#00B8FF]"
                            />
                            <span>Recordar correo en este dispositivo</span>
                          </label>

                          {biometricSupported && !lastBiometricCredential && (
                            <label className="flex items-center gap-2 text-xs text-[#00D1FF] select-none cursor-pointer">
                              <input
                                type="checkbox"
                                checked={enableBiometricsAfterLogin}
                                onChange={(e) => setEnableBiometricsAfterLogin(e.target.checked)}
                                className="rounded border-[#00B8FF]/30 bg-[#030816] text-[#0066FF] focus:ring-[#00B8FF]"
                              />
                              <span>Activar {biometricLabel} al iniciar sesión</span>
                            </label>
                          )}
                        </div>

                        <button
                          type="submit"
                          disabled={loading || secondsLeft > 0}
                          className="w-full py-2.5 px-4 rounded-xl axy-brand-gradient hover:brightness-110 text-white font-semibold text-sm shadow-[0_10px_28px_-6px_rgba(0,102,255,0.65)] transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <span>{loading ? 'Validando acceso...' : 'Iniciar sesión'}</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </form>

                      <div className="relative flex items-center py-0.5">
                        <div className="flex-1 border-t border-white/10" />
                        <span className="px-3 text-[11px] text-slate-400">o acceso federado</span>
                        <div className="flex-1 border-t border-white/10" />
                      </div>

                      <button
                        type="button"
                        disabled={googleLoading || loading}
                        onClick={() => handleGoogleLogin()}
                        className="w-full py-2.5 px-4 rounded-xl border border-[#00B8FF]/20 bg-white/[0.03] hover:bg-[#0066FF]/10 hover:border-[#00B8FF]/40 text-slate-100 text-xs font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2.5 cursor-pointer"
                      >
                        <Globe className="w-4 h-4 text-[#00B8FF]" />
                        <span>
                          {googleLoading ? 'Conectando con Google...' : 'Continuar con cuenta Google'}
                        </span>
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => selectPortal(null)}
                    className="w-full inline-flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer pt-1"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Elegir otro tipo de acceso</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="relative z-10 text-center text-[11px] text-slate-500">
        AxyCore Enterprise Financial Platform · America/Santo_Domingo
      </footer>
    </div>
  );
}
