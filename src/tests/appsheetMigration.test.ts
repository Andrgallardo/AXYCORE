import { describe, expect, it } from 'vitest';
import {
  buildAppSheetMigrationBundle,
  normalizeAppSheetDateIso,
} from '../engine/appsheetMigrationEngine';
import { computeFinancialStatements } from '../engine/accountingEngine';

describe('AppSheet to AxyCore Migration Engine', () => {
  it('normalizes AppSheet en-US dates and legacy 2000-01-01 dates', () => {
    expect(normalizeAppSheetDateIso('10/08/2026 14:51:40')).toBe('2026-10-08');
    expect(normalizeAppSheetDateIso('04/18/2026')).toBe('2026-04-18');
    expect(normalizeAppSheetDateIso('01/01/2000 00:00:00')).toBe('2026-01-15');
  });

  it('adapts Clientes, Solicitudes, Prestamos, Cuotas, Pagos and integrates with Financial Statements', () => {
    const bundle = buildAppSheetMigrationBundle({
      organizationId: 'org_axycore_main',
      actorUid: 'admin_uid_1',
      actorName: 'Admin Migrador',
      referenceDateIso: '2026-11-18',
      tables: {
        Clientes: [
          {
            ID_CLIENTE: 'CW-BF3F0B80990147E9AB263F76DD75CE76',
            NOMBRE: 'Jose Luis',
            APELLIDO: 'Peralta',
            NOMBRE_COMPLETO: 'Jose Luis Peralta',
            CEDULA: '40225805858',
            TELEFONO: '8494283014',
            EMAIL: 'joseluisperalta75@gmail.com',
            DIRECCION: 'Carretera Jacagua Residencial Gabriel',
            PROVINCIA: 'Santiago',
            MUNICIPIO: 'Santiago',
            INGRESOS_MENSUALES: '30000',
            GASTOS_MENSUALES: '25000',
            ESTADO: 'Activo',
            FECHA_REGISTRO: '10/08/2026 12:33:49',
            TIPO_SOLICITANTE: 'Persona Física',
          },
          {
            ID_CLIENTE: 'MIG1-C-67',
            NOMBRE: 'Inversiones',
            APELLIDO: 'Jucar',
            NOMBRE_COMPLETO: 'Inversiones Jucar',
            CEDULA: '',
            TELEFONO: '',
            ESTADO: 'Activo',
            FECHA_REGISTRO: '11/01/2026 15:21:33',
            TIPO_SOLICITANTE: 'Empresa',
          },
        ],
        Solicitudes: [
          {
            ID_SOLICITUD: 'WEB-BF3F0B80990147E9AB263F76DD75CE76',
            ID_CLIENTE: 'CW-BF3F0B80990147E9AB263F76DD75CE76',
            FECHA_SOLICITUD: '10/08/2026 12:33:57',
            NOMBRE_COMPLETO: 'Jose Luis Peralta',
            NUMERO_DOCUMENTO: '40225805858',
            MONTO_SOLICITADO: '10000',
            FRECUENCIA_SOLICITADA: 'Quincenal',
            PLAZO_SOLICITADO: '6',
            TIPO_TASA_SOLICITADA: 'Fija',
            ESTADO_SOLICITUD: 'Desembolsada',
            CEDULA_SOLICITUD: 'SolicitudDocumentos/cedula.jpg',
          },
        ],
        Formalizacion: [
          {
            ID_FORMALIZACION: 'FOR-WEB-BF3F0B80990147E9AB263F76DD75CE76',
            ID_SOLICITUD: 'WEB-BF3F0B80990147E9AB263F76DD75CE76',
            ID_CLIENTE: 'CW-BF3F0B80990147E9AB263F76DD75CE76',
            MONTO_APROBADO: '10000',
            GASTOS_LEGALES: '1000',
            MONTO_FINANCIADO: '11000',
            MONTO_A_DESEMBOLSAR: '10000',
            TASA_APROBADA: '5',
            PLAZO_APROBADO: '6',
            FRECUENCIA_APROBADA: 'Quincenal',
            CONTRATO: 'FORMALIZACION_Images/contrato.png',
          },
        ],
        Desembolsos: [
          {
            ID_DESEMBOLSO: '4e6a4b4b',
            ID_SOLICITUD: 'WEB-BF3F0B80990147E9AB263F76DD75CE76',
            ID_CLIENTE: 'CW-BF3F0B80990147E9AB263F76DD75CE76',
            MONTO_APROBADO: '10000',
            GASTOS_LEGALES: '1000',
            MONTO_FINANCIADO: '11000',
            MONTO_DESEMBOLSADO: '10000',
            FECHA_DESEMBOLSO: '10/08/2026 14:51:40',
            CUENTA_DESTINO: '08557808448',
            ESTADO_DESEMBOLSO: 'Realizado',
          },
        ],
        Prestamos: [
          {
            ID_PRESTAMO: 'ce737baf',
            ID_CLIENTE: 'CW-BF3F0B80990147E9AB263F76DD75CE76',
            ID_SOLICITUD: 'WEB-BF3F0B80990147E9AB263F76DD75CE76',
            ID_DESEMBOLSO: '4e6a4b4b',
            MONTO_DESEMBOLSADO: '10000',
            MONTO: '11000',
            TASA: '5',
            PLAZO: '6',
            FRECUENCIA_PAGO: 'Quincenal',
            TIPO_INTERES: 'Fija',
            CUOTA: '2108.33',
            NUMERO_CUOTAS: '6',
            TOTAL_A_PAGAR: '12650',
            FECHA_DESEMBOLSO: '10/08/2026 14:51:40',
            CAPITAL_PENDIENTE: '9166.67',
            ESTADO: 'Activo',
            CAPITAL_RECUPERADO: '1833.33',
            INTERES_COBRADO: '275',
            MORA_COBRADA: '396.67',
          },
        ],
        Cuotas: [
          {
            ID_CUOTA: 'AXY-Q-ce737baf-1',
            ID_PRESTAMO: 'ce737baf',
            ID_CLIENTE: 'CW-BF3F0B80990147E9AB263F76DD75CE76',
            NUMERO_CUOTA: '1',
            FECHA_VENCIMIENTO: '10/23/2026',
            CUOTA: '2108.33',
            CAPITAL: '1833.33',
            INTERES: '275',
            BALANCE_CAPITAL: '9166.67',
            CAPITAL_PAGADO: '1833.33',
            INTERES_PAGADO: '275',
            MORA_PAGADA: '396.67',
            ESTADO: 'Pagada',
          },
          {
            ID_CUOTA: 'AXY-Q-ce737baf-2',
            ID_PRESTAMO: 'ce737baf',
            ID_CLIENTE: 'CW-BF3F0B80990147E9AB263F76DD75CE76',
            NUMERO_CUOTA: '2',
            FECHA_VENCIMIENTO: '11/15/2026',
            CUOTA: '2108.33',
            CAPITAL: '1833.33',
            INTERES: '275',
            BALANCE_CAPITAL: '7333.34',
            CAPITAL_PAGADO: '0',
            INTERES_PAGADO: '0',
            MORA_PAGADA: '0',
            ESTADO: 'Vencida',
          },
        ],
        Pagos: [
          {
            ID_PAGO: '5d88258d',
            ID_PRESTAMO: 'ce737baf',
            ID_CUOTA: 'AXY-Q-ce737baf-1',
            ID_CLIENTE: 'CW-BF3F0B80990147E9AB263F76DD75CE76',
            FECHA_PAGO: '10/25/2026 11:00:00',
            MONTO_PAGADO: '2505',
            CAPITAL_PAGADO: '1833.33',
            INTERES_PAGADO: '275',
            MORA_PAGADA: '396.67',
            METODO_PAGO: 'Transferencia',
            APLICADO: 'Y',
            TIPO_MOVIMIENTO: 'PAGO REAL',
          },
        ],
      },
    });

    expect(bundle.summary.customersCount).toBe(2);
    expect(bundle.summary.businessesCount).toBe(1);
    expect(bundle.summary.loansCount).toBe(1);
    expect(bundle.summary.installmentsCount).toBe(2);
    expect(bundle.summary.paymentsCount).toBe(1);
    expect(bundle.summary.collectionReceiptsCount).toBe(1);

    // Check DPD classification for Cobros del día (1-5 days overdue since 2026-11-15 vs 2026-11-18 = 3 DPD -> TEMPRANA / bucket 1_5)
    expect(bundle.collectionAccounts[0].dpd).toBe(3);
    expect(bundle.collectionAccounts[0].stage).toBe('TEMPRANA');
    expect(bundle.collectionAccounts[0].bucket).toBe('1_5');

    // Verify Financial Statements integration
    const report = computeFinancialStatements({
      currency: 'DOP',
      year: 2026,
      loans: bundle.loans,
      disbursements: bundle.disbursements,
      collectionReceipts: bundle.collectionReceipts,
      payments: bundle.payments,
      paymentAllocations: bundle.paymentAllocations,
      operatingExpenses: bundle.operatingExpenses,
      investors: bundle.investors,
      investorTransactions: bundle.investorTransactions,
    });

    const totalCol = report.yearTotalColumn;
    expect(totalCol.incomeStatement.interestIncome).toBe(275);
    expect(totalCol.incomeStatement.lateFeeIncome).toBe(396.67);
    expect(totalCol.balanceSheet.totalAssets).toBeCloseTo(
      totalCol.balanceSheet.totalLiabilitiesAndEquity,
      2
    );
  });
});


