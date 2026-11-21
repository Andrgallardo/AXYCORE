import { describe, expect, it } from 'vitest';
import {
  parseAppSheetExportText,
  parseFlexibleDateIso,
  parseFlexibleNumber,
  prepareAppSheetMigrationPlan,
  sanitizeFirestoreDocId,
} from '../engine/appsheetMigrationEngine';

const VALID_DOC_ID_REGEX = /^[a-zA-Z0-9_-]{3,128}$/;

const ALLOWED_LOAN_KEYS = new Set([
  'id',
  'organizationId',
  'loanNumber',
  'applicationId',
  'disbursementId',
  'approvedFinancialAnalysisId',
  'customerId',
  'businessId',
  'applicantDisplayName',
  'productCode',
  'currency',
  'approvedPrincipal',
  'financedExpenses',
  'totalFinancedPrincipal',
  'currentPrincipalBalance',
  'contractualRateMonthly',
  'termMonths',
  'frequency',
  'amortizationMethod',
  'disbursementDate',
  'firstPaymentDate',
  'maturityDate',
  'totalContractualInterest',
  'totalContractualPayable',
  'status',
  'paidPrincipalTotal',
  'paidInterestTotal',
  'paidLateFeeTotal',
  'closedAt',
  'closureCertificateNumber',
  'createdBy',
  'createdAt',
  'updatedAt',
]);

describe('appsheetMigrationEngine — Copia Completa y Reconciliación de Cartera', () => {
  it('normaliza montos RD$/US$, decimales latinos y fechas DD/MM/YYYY', () => {
    expect(parseFlexibleNumber('RD$ 25,450.75')).toBe(25450.75);
    expect(parseFlexibleNumber('12.345,67')).toBe(12345.67);
    expect(parseFlexibleNumber('US$1,200.00')).toBe(1200);
    expect(parseFlexibleDateIso('15/03/2026', '2026-01-01')).toBe('2026-03-15');
    expect(parseFlexibleDateIso('2026-04-02T14:30:00Z', '2026-01-01')).toBe('2026-04-02');
  });

  it('genera IDs determinísticos seguros para Firestore sin colisiones', () => {
    const id1 = sanitizeFirestoreDocId('loan_as', 'PRE #001/2026');
    const id2 = sanitizeFirestoreDocId('loan_as', 'PRE #001/2026');
    const id3 = sanitizeFirestoreDocId('loan_as', 'PRE_001/2026');
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
    expect(VALID_DOC_ID_REGEX.test(id1)).toBe(true);
    expect(VALID_DOC_ID_REGEX.test(id3)).toBe(true);
  });

  it('mapea clientes, préstamos DOP/USD, cuotas, pagos y cobros activos con exactitud de Cartera Total y respeto estricto a firestore.rules', () => {
    const plan = prepareAppSheetMigrationPlan({
      organizationId: 'org_axycore_main',
      actorUid: 'uid_admin_1',
      actorName: 'Superadmin',
      todayIso: '2026-11-21',
      dataset: {
        customers: [
          {
            id_cliente: 'C-01',
            Nombre: 'Juan',
            Apellido: 'Pérez Gómez',
            Cedula: '001-1234567-8',
            Telefono: '8095551111',
          },
        ],
        loans: [
          {
            id_prestamo: 'L-100',
            numero_prestamo: 'PRE-0100',
            id_cliente: 'C-01',
            Moneda: 'DOP',
            monto_aprobado: 'RD$ 100,000.00',
            saldo_capital: 'RD$ 62,500.00',
            tasa_mensual: '5',
            plazo_meses: '12',
            frecuencia: 'QUINCENAL',
            fecha_desembolso: '01/06/2026',
            estado: 'Vigente',
          },
          {
            id_prestamo: 'L-101',
            numero_prestamo: 'PRE-0101',
            nombre_cliente: 'María Rodríguez',
            Moneda: 'DOP',
            monto_aprobado: 'RD$ 50,000.00',
            saldo_capital: 'RD$ 40,000.00',
            estado: 'Vencido',
          },
          {
            id_prestamo: 'L-102',
            numero_prestamo: 'PRE-0102',
            id_cliente: 'C-01',
            Moneda: 'DOP',
            monto_aprobado: 'RD$ 30,000.00',
            saldo_capital: '0',
            estado: 'Pagado',
          },
          {
            id_prestamo: 'L-103',
            numero_prestamo: 'PRE-0103',
            nombre_cliente: 'María Rodríguez',
            Moneda: 'USD',
            monto_aprobado: 'US$ 2,000.00',
            saldo_capital: 'US$ 1,500.00',
            estado: 'Activo',
          },
        ],
        installments: [
          {
            id_cuota: 'I-1',
            id_prestamo: 'L-100',
            numero_cuota: 1,
            fecha_vencimiento: '15/06/2026',
            capital: 8000,
            interes: 2000,
            total: 10000,
            estado: 'Pagada',
          },
        ],
        payments: [
          {
            id_pago: 'P-1',
            numero_prestamo: 'PRE-0100',
            monto_pagado: 'RD$ 37,500.00',
            fecha_pago: '15/08/2026',
            metodo: 'Transferencia',
            estado: 'Aplicado',
            abono_capital: '37500',
          },
        ],
        actions: [
          {
            id_cobro: 'G-1',
            numero_prestamo: 'PRE-0101',
            canal: 'WhatsApp',
            resultado: 'Promesa de pago para mañana',
            notas: 'Cliente confirmó depósito matutino',
            dias_atraso: 18,
          },
        ],
        promises: [
          {
            id_promesa: 'PR-1',
            id_prestamo: 'L-101',
            monto_prometido: 'RD$ 12,000.00',
            fecha_promesa: '22/11/2026',
            estado: 'Vigente',
          },
        ],
      },
    });

    // María Rodríguez appears in L-101 & L-103 -> synthesized only once!
    expect(plan.customers.length).toBe(2);
    expect(plan.loans.length).toBe(4);
    expect(plan.installments.length).toBe(1);
    expect(plan.payments.length).toBe(1);
    expect(plan.actions.length).toBe(1);
    expect(plan.promises.length).toBe(1);

    // Exact Cartera Total sums (ACTIVO + VENCIDO only, PAGADO = 0)
    expect(plan.summary.dop.activePortfolioCapital).toBe(102500); // 62500 + 40000
    expect(plan.summary.dop.activeLoansCount).toBe(1);
    expect(plan.summary.dop.overdueLoansCount).toBe(1);
    expect(plan.summary.dop.paidLoansCount).toBe(1);
    expect(plan.summary.dop.appliedPaymentsTotal).toBe(37500);
    expect(plan.summary.usd.activePortfolioCapital).toBe(1500);

    // Every loan complies strictly with firestore.rules key whitelist
    for (const loan of plan.loans) {
      expect(VALID_DOC_ID_REGEX.test(loan.id)).toBe(true);
      expect(loan.approvedPrincipal).toBeGreaterThan(0);
      expect(loan.termMonths).toBeGreaterThanOrEqual(1);
      expect(loan.termMonths).toBeLessThanOrEqual(360);
      for (const k of Object.keys(loan)) {
        expect(ALLOWED_LOAN_KEYS.has(k)).toBe(true);
      }
    }
  });

  it('recupera saldo desde cuotas pendientes o CARTERA_COBRANZA cuando la hoja PRESTAMOS viene sin saldo', () => {
    const plan = prepareAppSheetMigrationPlan({
      organizationId: 'org_axycore_main',
      actorUid: 'uid_admin_1',
      actorName: 'Admin',
      dataset: {
        customers: [],
        loans: [
          {
            id_prestamo: 'L-REC-1',
            numero_prestamo: 'PRE-900',
            cliente: 'Carlos Méndez',
            monto_aprobado: '20000',
            estado: 'Activo',
          },
        ],
        installments: [
          { id_prestamo: 'L-REC-1', numero_cuota: 1, capital: '5000', estado: 'Pagada' },
          { id_prestamo: 'L-REC-1', numero_cuota: 2, capital: '5000', estado: 'Pendiente' },
          { id_prestamo: 'L-REC-1', numero_cuota: 3, capital: '5000', estado: 'Pendiente' },
        ],
        payments: [],
        actions: [],
        promises: [],
      },
    });

    expect(plan.loans[0].currentPrincipalBalance).toBe(10000);
    expect(plan.summary.dop.activePortfolioCapital).toBe(10000);
  });

  it('interpreta correctamente exportaciones CSV de AppSheet con comillas y saltos de línea', () => {
    const csv = [
      'id_prestamo,cliente,monto_aprobado,saldo_capital,estado',
      '"L-1","Pérez, Juan","RD$ 45,000.00","30,000.00","Activo"',
      '"L-2","Gómez Ana","15000","0","Pagado"',
    ].join('\n');

    const rows = parseAppSheetExportText(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].cliente).toBe('Pérez, Juan');
    expect(rows[0].monto_aprobado).toBe('RD$ 45,000.00');
    expect(rows[1].estado).toBe('Pagado');
  });

  it('maneja el esquema real de AppSheet: fechas MM/DD/YYYY, deduplicación por cédula, ID_PRESTAMO, estado Pagado con saldo residual y APLICADO/ANULADO en PAGOS', () => {
    expect(parseFlexibleDateIso('10/21/2026 14:35:52', '2026-01-01')).toBe('2026-10-21');
    expect(parseFlexibleDateIso('07/06/2026 00:00:00', '2026-01-01')).toBe('2026-07-06');
    expect(parseFlexibleDateIso('11/07/2026', '2026-01-01')).toBe('2026-11-07');

    const plan = prepareAppSheetMigrationPlan({
      organizationId: 'org_axycore_main',
      actorUid: 'uid_super',
      actorName: 'Superadmin',
      todayIso: '2026-11-21',
      dataset: {
        customers: [
          {
            ID_CLIENTE: 'CW-AAA111',
            NOMBRE: 'Pedro',
            APELLIDO: 'Castillo',
            CEDULA: '00199988877',
            TELEFONO: '8095550001',
            EMAIL: 'pedro@example.com',
          },
          {
            // Repeat customer row with same cedula & different ID_CLIENTE
            ID_CLIENTE: 'MIG1-C-98',
            NOMBRE: 'Pedro',
            APELLIDO: 'Castillo',
            CEDULA: '001-9998887-7',
            TELEFONO: '',
            DIRECCION: 'Santo Domingo Este',
          },
        ],
        applications: [
          { ID_SOLICITUD: 'SOL-98', MONEDA_PROPUESTA: 'DOP', TIPO_SOLICITUD: 'Efectivo' },
          { ID_SOLICITUD: 'SOL-53', MONEDA_PROPUESTA: 'DOP', TIPO_SOLICITUD: 'Efectivo' },
        ],
        loans: [
          {
            ID_PRESTAMO: 'MIG1-L-98',
            ID_CLIENTE: 'MIG1-C-98',
            ID_SOLICITUD: 'SOL-98',
            MONTO: '2880000',
            MONTO_DESEMBOLSADO: '2870000',
            CAPITAL_PENDIENTE: '2880000',
            CAPITAL_RECUPERADO: '0',
            TASA: '3.5',
            PLAZO: '4',
            FRECUENCIA_PAGO: 'Mensual',
            TIPO_INTERES: 'Fija',
            TOTAL_A_PAGAR: '3398400',
            FECHA_DESEMBOLSO: '07/06/2026 00:00:00',
            ESTADO: 'Activo',
            CUOTAS_VENCIDAS: '1',
          },
          {
            // Explicitly Pagado with stale CAPITAL_PENDIENTE=4000 -> must stay PAGADO with 0 active capital
            ID_PRESTAMO: 'MIG1-L-53',
            ID_CLIENTE: 'CW-AAA111',
            ID_SOLICITUD: 'SOL-53',
            MONTO: '20000',
            MONTO_DESEMBOLSADO: '20000',
            CAPITAL_PENDIENTE: '4000',
            CAPITAL_RECUPERADO: '20000',
            TASA: '5',
            PLAZO: '6',
            FRECUENCIA_PAGO: 'Mensual',
            TIPO_INTERES: 'Fija',
            FECHA_DESEMBOLSO: '05/01/2026 00:00:00',
            ESTADO: 'Pagado',
          },
        ],
        installments: [
          {
            ID_CUOTA: 'Q-98-1',
            ID_PRESTAMO: 'MIG1-L-98',
            NUMERO_CUOTA: '1',
            FECHA_VENCIMIENTO: '08/06/2026',
            CUOTA: '849600',
            CAPITAL: '720000',
            INTERES: '129600',
            BALANCE_CAPITAL: '2160000',
            ESTADO: 'Vencida',
          },
        ],
        payments: [
          {
            ID_PAGO: 'P-1',
            ID_PRESTAMO: 'MIG1-L-98',
            FECHA_PAGO: '09/23/2026 15:32:10',
            MONTO_PAGADO: '10000',
            CAPITAL_PAGADO: '7500',
            INTERES_PAGADO: '2500',
            METODO_PAGO: 'Transferencia',
            APLICADO: 'Y',
            TIPO_MOVIMIENTO: 'PAGO REAL',
            OBSERVACION: 'Recibo histórico aplicado',
          },
          {
            ID_PAGO: 'P-2',
            ID_PRESTAMO: 'MIG1-L-98',
            FECHA_PAGO: '10/01/2026',
            MONTO_PAGADO: '5000',
            METODO_PAGO: 'Efectivo',
            APLICADO: 'N',
            TIPO_MOVIMIENTO: 'PAGO REAL',
          },
          {
            ID_PAGO: 'P-3',
            ID_PRESTAMO: 'MIG1-L-98',
            FECHA_PAGO: '10/02/2026',
            MONTO_PAGADO: '5000',
            METODO_PAGO: 'Transferencia',
            APLICADO: 'Y',
            TIPO_MOVIMIENTO: 'ANULADO',
          },
        ],
        actions: [],
        promises: [],
      },
    });

    // Deduplicated to 1 unique customer with merged email + address, zero duplicate IDs
    expect(plan.customers).toHaveLength(1);
    expect(plan.customers[0].email).toBe('pedro@example.com');
    expect(plan.customers[0].address).toBe('Santo Domingo Este');

    // Both loans linked to same deduplicated customer and preserve real ID_PRESTAMO loanNumber
    expect(plan.loans).toHaveLength(2);
    expect(plan.loans[0].loanNumber).toBe('MIG1-L-98');
    expect(plan.loans[0].customerId).toBe(plan.customers[0].id);
    expect(plan.loans[0].status).toBe('VENCIDO');
    expect(plan.loans[0].approvedPrincipal).toBe(2870000);
    expect(plan.loans[0].totalFinancedPrincipal).toBe(2880000);
    expect(plan.loans[0].financedExpenses).toBe(10000);
    expect(plan.loans[0].disbursementDate).toBe('2026-07-06');

    expect(plan.loans[1].loanNumber).toBe('MIG1-L-53');
    expect(plan.loans[1].status).toBe('PAGADO');
    expect(plan.loans[1].currentPrincipalBalance).toBe(0);

    // Exact active portfolio capital excludes stale Pagado balance
    expect(plan.summary.dop.activePortfolioCapital).toBe(2880000);

    // Installment maps CUOTA & BALANCE_CAPITAL accurately
    expect(plan.installments[0].totalAmount).toBe(849600);
    expect(plan.installments[0].remainingPrincipalBalance).toBe(2160000);
    expect(plan.installments[0].dueDate).toBe('2026-08-06');

    // Payments honor APLICADO & TIPO_MOVIMIENTO=ANULADO
    expect(plan.payments.map((p) => p.status)).toEqual([
      'APLICADO',
      'RECIBIDO_PENDIENTE_VERIFICACION',
      'REVERTIDO',
    ]);
    expect(plan.payments[0].method).toBe('TRANSFERENCIA');
    expect(plan.payments[0].notes).toBe('Recibo histórico aplicado');
  });
});
