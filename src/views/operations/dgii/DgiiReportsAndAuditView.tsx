import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, History, Search } from 'lucide-react';
import { useAxyCore } from '../../../context/AxyCoreContext';
import { round2 } from '../../../engine/dgii/dgiiCatalogAndValidation';
import { buildFormato606Rows, buildFormato607Rows } from '../../../engine/dgii/dgiiReportsEngine';
import { ECF_STATUS_LABELS, ECF_TYPE_META } from '../../../types/dgiiEcf';
import { formatMoney } from '../../../utils/formatters';

type ReportTab = '607' | '606' | 'mensual' | 'por_cliente' | 'secuencias';

function exportCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DgiiReportsAndAuditView({ mode }: { mode: 'reports' | 'audit' }) {
  const { organization, rbac, dgiiEcfDocuments, dgiiSequences, dgiiAuditLogs, activeDgiiConfig } = useAxyCore();
  const canExport = rbac.hasPermission('EXPORT_FISCAL_REPORTS');
  const baseCurrency = activeDgiiConfig.defaultCurrency || organization.currency || 'DOP';

  const [periodYm, setPeriodYm] = useState(() => new Date().toISOString().slice(0, 7));
  const [reportTab, setReportTab] = useState<ReportTab>('607');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditEventFilter, setAuditEventFilter] = useState('ALL');

  const rows607 = useMemo(
    () => buildFormato607Rows(dgiiEcfDocuments, periodYm || undefined),
    [dgiiEcfDocuments, periodYm]
  );

  const rows606 = useMemo(
    () => buildFormato606Rows(dgiiEcfDocuments, periodYm || undefined),
    [dgiiEcfDocuments, periodYm]
  );

  const byCustomerRows = useMemo(() => {
    const map = new Map<string, { taxId: string; name: string; count: number; subtotal: number; itbis: number; total: number }>();
    for (const d of dgiiEcfDocuments) {
      if (d.direction !== 'EMITIDO' || d.status === 'BORRADOR' || d.status === 'ANULADA') continue;
      if (periodYm && !d.issueDate.startsWith(periodYm)) continue;
      const key = `${d.receiverTaxId}_${d.receiverName}`;
      const cur = map.get(key) || {
        taxId: d.receiverTaxId || 'Sin ID',
        name: d.receiverName,
        count: 0,
        subtotal: 0,
        itbis: 0,
        total: 0,
      };
      const sign = d.ecfType === '34' ? -1 : 1;
      cur.count += 1;
      cur.subtotal = round2(cur.subtotal + sign * (d.subtotal - d.totalDiscount));
      cur.itbis = round2(cur.itbis + sign * d.totalItbis);
      cur.total = round2(cur.total + sign * d.totalAmount);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [dgiiEcfDocuments, periodYm]);

  const byTypeAndStatus = useMemo(() => {
    const map = new Map<string, { type: string; count: number; total: number; itbis: number; voided: number }>();
    for (const d of dgiiEcfDocuments) {
      if (d.direction !== 'EMITIDO' || d.status === 'BORRADOR') continue;
      if (periodYm && !d.issueDate.startsWith(periodYm)) continue;
      const cur = map.get(d.ecfType) || {
        type: ECF_TYPE_META[d.ecfType].name,
        count: 0,
        total: 0,
        itbis: 0,
        voided: 0,
      };
      cur.count += 1;
      if (d.status === 'ANULADA') {
        cur.voided += 1;
      } else {
        cur.total = round2(cur.total + d.totalAmount);
        cur.itbis = round2(cur.itbis + d.totalItbis);
      }
      map.set(d.ecfType, cur);
    }
    return Array.from(map.entries());
  }, [dgiiEcfDocuments, periodYm]);

  const filteredAudit = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return dgiiAuditLogs
      .filter((l) => {
        if (auditEventFilter !== 'ALL' && l.eventType !== auditEventFilter) return false;
        if (q) {
          const hay = `${l.eNCF || ''} ${l.summary} ${l.actorEmail} ${l.eventType}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.timestampIso.localeCompare(a.timestampIso));
  }, [dgiiAuditLogs, auditSearch, auditEventFilter]);

  const handleExportCurrentReport = () => {
    if (!canExport) return;
    if (reportTab === '607') {
      exportCsv(
        `DGII_607_${activeDgiiConfig.rnc}_${periodYm || 'historico'}.csv`,
        ['RNC/Cedula', 'TipoId', 'eNCF', 'NCF Modificado', 'Fecha', 'Monto Facturado', 'ITBIS', 'Exento', 'Otros Impuestos', 'Estado DGII'],
        rows607.map((r) => [
          r.rncCedulaComprador,
          r.tipoIdentificacion,
          r.eNCF,
          r.ncfModificado,
          r.fechaComprobante,
          r.montoFacturado.toFixed(2),
          r.itbisFacturado.toFixed(2),
          r.montoExento.toFixed(2),
          r.otrosImpuestos.toFixed(2),
          r.estadoDgii,
        ])
      );
    } else if (reportTab === '606') {
      exportCsv(
        `DGII_606_${activeDgiiConfig.rnc}_${periodYm || 'historico'}.csv`,
        ['RNC/Cedula Suplidor', 'TipoId', 'eNCF', 'Fecha', 'Servicios', 'Bienes', 'Total Facturado', 'ITBIS', 'Estado'],
        rows606.map((r) => [
          r.rncCedulaSuplidor,
          r.tipoIdentificacion,
          r.eNCF,
          r.fechaComprobante,
          r.montoFacturadoServicios.toFixed(2),
          r.montoFacturadoBienes.toFixed(2),
          r.totalMontoFacturado.toFixed(2),
          r.itbisFacturado.toFixed(2),
          r.estadoDgii,
        ])
      );
    } else if (reportTab === 'por_cliente') {
      exportCsv(
        `Resumen_Clientes_eCF_${periodYm || 'historico'}.csv`,
        ['RNC/Cedula', 'Cliente', 'Cantidad', 'Subtotal', 'ITBIS', 'Total'],
        byCustomerRows.map((r) => [r.taxId, r.name, r.count, r.subtotal.toFixed(2), r.itbis.toFixed(2), r.total.toFixed(2)])
      );
    }
  };

  if (mode === 'audit') {
    return (
      <div className="space-y-6 text-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <History className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
              <span>Auditoría y Trazabilidad Inmutable DGII e-CF</span>
            </h2>
            <p className="text-slate-500 dark:text-slate-400">
              Registro cronológico inmutable de reservas e-NCF, firmas XMLDSig, transmisiones DGII, TrackIds, anulaciones
              y contabilización automática.
            </p>
          </div>
          {canExport && (
            <button
              type="button"
              onClick={() =>
                exportCsv(
                  `dgii_audit_${organization.id}.csv`,
                  ['Fecha', 'Evento', 'Ambiente', 'eNCF', 'Resumen', 'Usuario', 'Rol'],
                  filteredAudit.map((l) => [
                    l.timestampIso,
                    l.eventType,
                    l.environment,
                    l.eNCF || '',
                    l.summary,
                    l.actorEmail,
                    l.actorRole,
                  ])
                )
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/15 font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
              <span>Exportar Bitácora CSV</span>
            </button>
          )}
        </div>

        <div className="p-3.5 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder="Buscar por e-NCF, usuario o descripción..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
            />
          </div>
          <select
            value={auditEventFilter}
            onChange={(e) => setAuditEventFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
          >
            <option value="ALL">Todos los eventos</option>
            <option value="SEQUENCE_RESERVED">Reserva e-NCF</option>
            <option value="XML_SIGNED">Firma XMLDSig</option>
            <option value="DGII_SUBMITTED">Envío DGII</option>
            <option value="DGII_STATUS_POLLED">Consulta TrackId</option>
            <option value="ACCOUNTING_POSTED">Asiento Contable</option>
            <option value="SEQUENCE_VOIDED">Anulaciones</option>
            <option value="CERT_UPLOADED">Certificados</option>
            <option value="CONFIG_UPDATED">Configuración</option>
            <option value="SANDBOX_TEST_RUN">Pruebas Sandbox</option>
          </select>
        </div>

        <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                  <th className="py-2.5 px-3">Fecha / Hora</th>
                  <th className="py-2.5 px-3">Evento</th>
                  <th className="py-2.5 px-3">Ambiente</th>
                  <th className="py-2.5 px-3">e-NCF</th>
                  <th className="py-2.5 px-3">Resumen</th>
                  <th className="py-2.5 px-3">Usuario</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      Sin eventos de auditoría DGII registrados todavía.
                    </td>
                  </tr>
                ) : (
                  filteredAudit.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100 dark:border-white/5">
                      <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                        {l.timestampIso.slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[11px]">{l.eventType}</td>
                      <td className="py-2.5 px-3">{l.environment}</td>
                      <td className="py-2.5 px-3 font-mono text-[#0052CC] dark:text-[#00D1FF]">{l.eNCF || '—'}</td>
                      <td className="py-2.5 px-3">{l.summary}</td>
                      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">
                        {l.actorEmail} ({l.actorRole})
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // FISCAL REPORTS MODE
  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
            <span>Reportes Fiscales DGII (Formato 607, 606 e ITBIS)</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            Resúmenes tributarios listos para envío mensual a la DGII e inspección de secuencias disponibles.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={periodYm}
            onChange={(e) => setPeriodYm(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#08132B] font-mono"
          />
          {canExport && (
            <button
              type="button"
              onClick={handleExportCurrentReport}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* Report Tabs */}
      <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200 dark:border-white/10 w-fit">
        {(
          [
            { id: '607', label: `Formato 607 Ventas (${rows607.length})` },
            { id: '606', label: `Formato 606 Compras (${rows606.length})` },
            { id: 'mensual', label: 'Por Tipo y Estado' },
            { id: 'por_cliente', label: 'Por Cliente / Receptor' },
            { id: 'secuencias', label: 'Secuencias Disponibles' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setReportTab(t.id)}
            className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
              reportTab === t.id
                ? 'bg-white dark:bg-[#0066FF] text-slate-950 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden">
        <div className="overflow-x-auto">
          {reportTab === '607' && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                  <th className="py-2.5 px-3">RNC / Cédula</th>
                  <th className="py-2.5 px-3">e-NCF</th>
                  <th className="py-2.5 px-3">NCF Modificado</th>
                  <th className="py-2.5 px-3">Fecha</th>
                  <th className="py-2.5 px-3 text-right">Monto Facturado</th>
                  <th className="py-2.5 px-3 text-right">ITBIS</th>
                  <th className="py-2.5 px-3 text-right">Exento</th>
                  <th className="py-2.5 px-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows607.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      No hay registros 607 para el período seleccionado.
                    </td>
                  </tr>
                ) : (
                  rows607.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-white/5">
                      <td className="py-2.5 px-3 font-mono">{r.rncCedulaComprador || 'Consumo'}</td>
                      <td className="py-2.5 px-3 font-mono font-bold">{r.eNCF}</td>
                      <td className="py-2.5 px-3 font-mono">{r.ncfModificado || '—'}</td>
                      <td className="py-2.5 px-3 font-mono">{r.fechaComprobante}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatMoney(r.montoFacturado, baseCurrency)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatMoney(r.itbisFacturado, baseCurrency)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatMoney(r.montoExento, baseCurrency)}</td>
                      <td className="py-2.5 px-3">{ECF_STATUS_LABELS[r.estadoDgii]}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {reportTab === '606' && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                  <th className="py-2.5 px-3">RNC/Cédula Suplidor</th>
                  <th className="py-2.5 px-3">e-NCF</th>
                  <th className="py-2.5 px-3">Fecha</th>
                  <th className="py-2.5 px-3 text-right">Servicios</th>
                  <th className="py-2.5 px-3 text-right">Bienes</th>
                  <th className="py-2.5 px-3 text-right">Total Facturado</th>
                  <th className="py-2.5 px-3 text-right">ITBIS</th>
                  <th className="py-2.5 px-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows606.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      No hay registros 606 para el período seleccionado.
                    </td>
                  </tr>
                ) : (
                  rows606.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-white/5">
                      <td className="py-2.5 px-3 font-mono">{r.rncCedulaSuplidor}</td>
                      <td className="py-2.5 px-3 font-mono font-bold">{r.eNCF}</td>
                      <td className="py-2.5 px-3 font-mono">{r.fechaComprobante}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatMoney(r.montoFacturadoServicios, baseCurrency)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatMoney(r.montoFacturadoBienes, baseCurrency)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatMoney(r.totalMontoFacturado, baseCurrency)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatMoney(r.itbisFacturado, baseCurrency)}</td>
                      <td className="py-2.5 px-3">{ECF_STATUS_LABELS[r.estadoDgii]}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {reportTab === 'mensual' && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                  <th className="py-2.5 px-3">Código</th>
                  <th className="py-2.5 px-3">Tipo de Comprobante</th>
                  <th className="py-2.5 px-3 text-right">Emitidos</th>
                  <th className="py-2.5 px-3 text-right">Anulados</th>
                  <th className="py-2.5 px-3 text-right">ITBIS Neto</th>
                  <th className="py-2.5 px-3 text-right">Total Facturado</th>
                </tr>
              </thead>
              <tbody>
                {byTypeAndStatus.map(([code, row]) => (
                  <tr key={code} className="border-b border-slate-100 dark:border-white/5">
                    <td className="py-2.5 px-3 font-mono font-bold">E{code}</td>
                    <td className="py-2.5 px-3">{row.type}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{row.count}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-rose-600">{row.voided}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatMoney(row.itbis, baseCurrency)}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold">{formatMoney(row.total, baseCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {reportTab === 'por_cliente' && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                  <th className="py-2.5 px-3">RNC / Cédula</th>
                  <th className="py-2.5 px-3">Cliente / Receptor</th>
                  <th className="py-2.5 px-3 text-right">Comprobantes</th>
                  <th className="py-2.5 px-3 text-right">Subtotal</th>
                  <th className="py-2.5 px-3 text-right">ITBIS</th>
                  <th className="py-2.5 px-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {byCustomerRows.map((r, idx) => (
                  <tr key={idx} className="border-b border-slate-100 dark:border-white/5">
                    <td className="py-2.5 px-3 font-mono">{r.taxId}</td>
                    <td className="py-2.5 px-3 font-semibold">{r.name}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{r.count}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatMoney(r.subtotal, baseCurrency)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatMoney(r.itbis, baseCurrency)}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold">{formatMoney(r.total, baseCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {reportTab === 'secuencias' && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                  <th className="py-2.5 px-3">Tipo</th>
                  <th className="py-2.5 px-3">Autorización</th>
                  <th className="py-2.5 px-3 text-right">Inicial</th>
                  <th className="py-2.5 px-3 text-right">Final</th>
                  <th className="py-2.5 px-3 text-right">Última Usada</th>
                  <th className="py-2.5 px-3 text-right">Disponibles</th>
                  <th className="py-2.5 px-3">Vence</th>
                </tr>
              </thead>
              <tbody>
                {dgiiSequences.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 dark:border-white/5">
                    <td className="py-2.5 px-3 font-semibold">{ECF_TYPE_META[s.ecfType].shortName}</td>
                    <td className="py-2.5 px-3 font-mono">{s.authorizationNumber}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{s.startSequence}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{s.endSequence}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{s.lastUsedSequence}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold">
                      {Math.max(0, s.endSequence - s.lastUsedSequence)}
                    </td>
                    <td className="py-2.5 px-3 font-mono">{s.expiryDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
