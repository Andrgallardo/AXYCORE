import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileCheck2,
  FileText,
  RefreshCw,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Upload,
  VideoOff,
  XCircle,
} from 'lucide-react';
import {
  BIOMETRIC_VERDICT_LABELS,
  buildBiometricAuditNote,
} from '../engine/biometricVerification';
import { verifyBiometricIdentityWithGemini } from '../services/axycoreStore';
import type { BiometricVerificationResult } from '../types/axycore';

export interface PendingIdentityFileItem {
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  fileDataUrl: string;
  notes?: string;
}

interface BiometricIdentityVerifierProps {
  applicantFullName: string;
  documentType: string;
  documentNumber: string;
  identityFiles: PendingIdentityFileItem[];
  onAttachIdentityFile: (file: File | null) => void;
  onSaveBiometricCapture: (capture: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    fileDataUrl: string;
    notes: string;
    result: BiometricVerificationResult;
  }) => void;
  onBiometricResultChange?: (result: BiometricVerificationResult | null) => void;
}

function estimateBase64ByteSize(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  const base64 = dataUrl.slice(commaIdx + 1);
  return Math.ceil((base64.length * 3) / 4);
}

export function BiometricIdentityVerifier({
  applicantFullName,
  documentType,
  documentNumber,
  identityFiles,
  onAttachIdentityFile,
  onSaveBiometricCapture,
  onBiometricResultChange,
}: BiometricIdentityVerifierProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [selectedIdIndex, setSelectedIdIndex] = useState<number>(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [capturedSelfieUrl, setCapturedSelfieUrl] = useState<string | null>(null);
  const [capturedBytes, setCapturedBytes] = useState<number>(0);

  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [result, setResult] = useState<BiometricVerificationResult | null>(null);

  const activeIdentityDoc = useMemo(() => {
    if (identityFiles.length === 0) return null;
    const safeIdx = selectedIdIndex < identityFiles.length ? selectedIdIndex : 0;
    return identityFiles[safeIdx];
  }, [identityFiles, selectedIdIndex]);

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Re-assign srcObject when video element mounts after cameraActive becomes true
  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {
        // Auto-play may resolve lazily depending on browser policies
      });
    }
  }, [cameraActive]);

  const handleStartCamera = async () => {
    setCameraError(null);
    setVerifyError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setCameraError(
        'Este navegador o contexto no soporta acceso directo a la cámara (getUserMedia).'
      );
      return;
    }

    setStartingCamera(true);
    try {
      stopCameraStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 960 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCapturedSelfieUrl(null);
      setResult(null);
      onBiometricResultChange?.(null);
      setCameraActive(true);
    } catch (err) {
      const errName = err instanceof DOMException ? err.name : '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setCameraError(
          'Permiso de cámara denegado. Habilita el acceso a la cámara en la configuración del navegador e intenta de nuevo.'
        );
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setCameraError(
          'No se detectó ninguna cámara disponible en este dispositivo.'
        );
      } else {
        setCameraError(
          err instanceof Error
            ? `No fue posible iniciar la cámara: ${err.message}`
            : 'No fue posible iniciar la cámara del dispositivo.'
        );
      }
    } finally {
      setStartingCamera(false);
    }
  };

  const handleCapturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const srcW = video.videoWidth || 640;
    const srcH = video.videoHeight || 480;
    const maxW = 840;
    const scale = srcW > maxW ? maxW / srcW : 1;
    const outW = Math.round(srcW * scale);
    const outH = Math.round(srcH * scale);

    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, outW, outH);

    // Comprimir progresivamente si excede ~380 KB para cumplir límite seguro de Firestore (450 KB)
    let quality = 0.85;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    let estBytes = estimateBase64ByteSize(dataUrl);

    while (estBytes > 380 * 1024 && quality > 0.45) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      estBytes = estimateBase64ByteSize(dataUrl);
    }

    setCapturedSelfieUrl(dataUrl);
    setCapturedBytes(estBytes);
    setVerifyError(null);
    setResult(null);
    onBiometricResultChange?.(null);
    stopCameraStream();
  };

  const handleRetake = async () => {
    setCapturedSelfieUrl(null);
    setCapturedBytes(0);
    setResult(null);
    onBiometricResultChange?.(null);
    await handleStartCamera();
  };

  const handleCompareWithVisionApi = async () => {
    if (!activeIdentityDoc || !capturedSelfieUrl) return;
    setVerifying(true);
    setVerifyError(null);

    try {
      const verification = await verifyBiometricIdentityWithGemini({
        identityDocumentDataUrl: activeIdentityDoc.fileDataUrl,
        identityDocumentMimeType: activeIdentityDoc.mimeType,
        identityDocumentFileName: activeIdentityDoc.fileName,
        selfieDataUrl: capturedSelfieUrl,
        selfieMimeType: 'image/jpeg',
        applicantMeta: {
          fullName: applicantFullName,
          documentType,
          documentNumber,
        },
      });

      setResult(verification);
      onBiometricResultChange?.(verification);

      const safeFileDoc = (documentNumber || 'solicitante').replace(/[^a-zA-Z0-9_-]/g, '');
      onSaveBiometricCapture({
        fileName: `biometria_selfie_${safeFileDoc}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: capturedBytes,
        fileDataUrl: capturedSelfieUrl,
        notes: buildBiometricAuditNote(verification),
        result: verification,
      });
    } catch (err) {
      setVerifyError(
        err instanceof Error
          ? err.message
          : 'Error al comparar la captura facial contra el documento de identidad.'
      );
    } finally {
      setVerifying(false);
    }
  };

  const verdictColorClass = !result
    ? ''
    : result.verdict === 'COINCIDE'
    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
    : result.verdict === 'REVISION_MANUAL'
    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
    : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200';

  return (
    <div className="axy-surface-ai rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 text-[#0066FF] dark:text-[#00D1FF] flex items-center justify-center shrink-0">
            <ScanFace className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Verificación Biométrica de Identidad (Cámara + Visión Artificial)
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Captura una fotografía en vivo del solicitante y compárala contra el rostro y datos del documento de identidad adjunto.
            </p>
          </div>
        </div>

        {result && (
          <div className="text-right">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
              Similitud Biométrica
            </span>
            <span className="text-lg font-bold font-mono tabular-nums text-[#0066FF] dark:text-[#00D1FF]">
              {result.similarityScore}%
            </span>
          </div>
        )}
      </div>

      {/* Dual Inspection Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Panel A: Documento de Identidad */}
        <div className="axy-surface rounded-xl p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              1. Documento de Identidad de Referencia
            </span>
            {identityFiles.length > 1 && (
              <select
                value={selectedIdIndex}
                onChange={(e) => setSelectedIdIndex(Number(e.target.value))}
                className="axy-input text-xs px-2 py-1 text-slate-900 dark:text-white"
              >
                {identityFiles.map((f, idx) => (
                  <option key={`${f.fileName}-${idx}`} value={idx}>
                    {f.fileName}
                  </option>
                ))}
              </select>
            )}
          </div>

          {!activeIdentityDoc ? (
            <div className="axy-surface-tonal h-52 rounded-lg border-dashed border-[#0066FF]/35 dark:border-[#00B8FF]/35 flex flex-col items-center justify-center p-4 text-center space-y-2.5">
              <FileText className="w-7 h-7 text-slate-400" />
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                Aún no hay un documento de identidad cargado. Adjunta la cédula o pasaporte (PNG, JPG, WEBP o PDF, máx. 450 KB).
              </p>
              <label className="axy-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Cargar Documento de Identidad</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    onAttachIdentityFile(e.target.files?.[0] ?? null);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="axy-surface-tonal h-52 rounded-lg overflow-hidden flex items-center justify-center">
                {activeIdentityDoc.mimeType.startsWith('image/') ? (
                  <img
                    src={activeIdentityDoc.fileDataUrl}
                    alt={activeIdentityDoc.fileName}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center p-4 space-y-1.5">
                    <FileCheck2 className="w-8 h-8 text-sky-600 mx-auto" />
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Documento PDF listo para análisis visual
                    </p>
                    <p className="text-[11px] font-mono text-slate-500">
                      {activeIdentityDoc.fileName}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span className="truncate font-mono">{activeIdentityDoc.fileName}</span>
                <span className="tabular-nums shrink-0 ml-2">
                  {Math.round(activeIdentityDoc.sizeBytes / 1024)} KB
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Panel B: Cámara / Captura en Vivo */}
        <div className="axy-surface rounded-xl p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              2. Captura Biométrica en Vivo (Selfie)
            </span>
            {cameraActive && (
              <button
                type="button"
                onClick={stopCameraStream}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-600 cursor-pointer"
              >
                <VideoOff className="w-3.5 h-3.5" />
                Detener cámara
              </button>
            )}
          </div>

          <div className="h-52 rounded-lg border border-slate-200/80 dark:border-[#00B8FF]/20 bg-[#040C1E] overflow-hidden relative flex items-center justify-center">
            {cameraActive ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {/* Guía sutil de encuadre facial */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-32 h-40 rounded-full border-2 border-dashed border-[#00D1FF]/80" />
                </div>
              </>
            ) : capturedSelfieUrl ? (
              <img
                src={capturedSelfieUrl}
                alt="Captura biométrica en vivo"
                className="w-full h-full object-contain bg-[#040C1E]"
              />
            ) : (
              <div className="text-center p-4 space-y-2">
                <Camera className="w-8 h-8 text-slate-500 mx-auto" />
                <p className="text-xs text-slate-400 max-w-xs">
                  Activa la cámara frontal con buena iluminación y encuadra el rostro mirando de frente.
                </p>
              </div>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />

          {/* Controles de cámara */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!cameraActive && !capturedSelfieUrl && (
              <button
                type="button"
                disabled={startingCamera}
                onClick={handleStartCamera}
                className="axy-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer disabled:opacity-60"
              >
                <Camera className="w-3.5 h-3.5" />
                {startingCamera ? 'Iniciando cámara...' : 'Activar Cámara'}
              </button>
            )}

            {cameraActive && (
              <button
                type="button"
                onClick={handleCapturePhoto}
                className="axy-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                Capturar Foto Biométrica
              </button>
            )}

            {capturedSelfieUrl && !cameraActive && (
              <div className="flex items-center justify-between w-full gap-2">
                <button
                  type="button"
                  disabled={verifying}
                  onClick={handleRetake}
                  className="axy-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retomar Foto
                </button>
                <span className="text-[11px] font-mono tabular-nums text-slate-500">
                  JPEG {Math.round(capturedBytes / 1024)} KB
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Errores de cámara o API */}
      {cameraError && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{cameraError}</span>
        </div>
      )}

      {verifyError && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{verifyError}</span>
        </div>
      )}

      {/* Botón principal de comparación */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          La captura verificada se adjunta automáticamente al expediente como evidencia biométrica.
        </p>
        <button
          type="button"
          disabled={!activeIdentityDoc || !capturedSelfieUrl || verifying}
          onClick={handleCompareWithVisionApi}
          className="axy-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ScanFace className="w-4 h-4" />
          {verifying
            ? 'Analizando rostro con Visión IA...'
            : 'Comparar Rostro con Documento (IA Visión)'}
        </button>
      </div>

      {/* Resultado estructurado del cotejo biométrico */}
      {result && (
        <div className={`rounded-xl border p-4 space-y-3 ${verdictColorClass}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {result.verdict === 'COINCIDE' ? (
                <ShieldCheck className="w-5 h-5 shrink-0" />
              ) : result.verdict === 'REVISION_MANUAL' ? (
                <ShieldAlert className="w-5 h-5 shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 shrink-0" />
              )}
              <div>
                <p className="text-sm font-bold">
                  {BIOMETRIC_VERDICT_LABELS[result.verdict]}
                </p>
                <p className="text-[11px] opacity-85 font-mono">
                  Modelo: {result.modelUsed} · Prueba de vida: {result.livenessAssessment}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
              <div className="w-28 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-current transition-all"
                  style={{ width: `${result.similarityScore}%` }}
                />
              </div>
              <span className="font-bold">{result.similarityScore}/100</span>
            </div>
          </div>

          <p className="text-xs leading-relaxed">{result.comparisonRationale}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs pt-1">
            <div className="rounded-lg bg-white/80 dark:bg-[#040C1E]/65 p-2.5 border border-black/5 dark:border-[#00B8FF]/15">
              <span className="block text-[10px] uppercase opacity-70">Rostro en Documento</span>
              <span className="font-semibold flex items-center gap-1 mt-0.5">
                {result.idPhotoDetected ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Detectado
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-600" /> No legible
                  </>
                )}
              </span>
            </div>
            <div className="rounded-lg bg-white/80 dark:bg-[#040C1E]/65 p-2.5 border border-black/5 dark:border-[#00B8FF]/15">
              <span className="block text-[10px] uppercase opacity-70">Rostro en Cámara</span>
              <span className="font-semibold flex items-center gap-1 mt-0.5">
                {result.selfieFaceDetected ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Detectado
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-600" /> No legible
                  </>
                )}
              </span>
            </div>
            <div className="rounded-lg bg-white/80 dark:bg-[#040C1E]/65 p-2.5 border border-black/5 dark:border-[#00B8FF]/15">
              <span className="block text-[10px] uppercase opacity-70">Titular OCR Cédula</span>
              <span className="font-semibold truncate block mt-0.5">
                {result.extractedDocName || 'No detectado'}
              </span>
            </div>
            <div className="rounded-lg bg-white/80 dark:bg-[#040C1E]/65 p-2.5 border border-black/5 dark:border-[#00B8FF]/15">
              <span className="block text-[10px] uppercase opacity-70">Número OCR Cédula</span>
              <span className="font-semibold font-mono truncate block mt-0.5">
                {result.extractedDocNumber || 'No detectado'}
              </span>
            </div>
          </div>

          <div className="text-[11px] opacity-90 space-y-1">
            <p>
              <strong>Integridad del documento:</strong> {result.documentIntegrityNotes}
            </p>
            {result.observations.length > 0 && (
              <ul className="list-disc pl-4 space-y-0.5">
                {result.observations.map((obs, idx) => (
                  <li key={idx}>{obs}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
