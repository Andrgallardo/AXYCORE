import {
  doc,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { generateId } from './axycoreStore';
import type {
  CurrencyCode,
  ExpenseCategory,
  ExpensePaymentMethod,
  ExpenseStatus,
  InvestorRecord,
  InvestorStatus,
  InvestorTransactionRecord,
  InvestorTransactionType,
  InvestorType,
  OperatingExpenseRecord,
  UserProfile,
} from '../types/axycore';

function canManageOperations(role: UserProfile['role']): boolean {
  return ['ADMIN', 'FINANCE', 'OPERATIONS', 'MANAGEMENT'].includes(role);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function createOperatingExpense(params: {
  organizationId: string;
  expenseDate: string;
  category: ExpenseCategory;
  concept: string;
  vendorName: string;
  invoiceNumber?: string;
  currency: CurrencyCode;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  status: 'PAGADO' | 'PENDIENTE';
  notes?: string;
  user: UserProfile;
}): Promise<OperatingExpenseRecord> {
  const {
    organizationId,
    expenseDate,
    category,
    concept,
    vendorName,
    invoiceNumber = '',
    currency,
    amount,
    paymentMethod,
    status,
    notes = '',
    user,
  } = params;

  if (!canManageOperations(user.role)) {
    throw new Error('Tu rol no tiene autorización para registrar gastos operativos.');
  }
  const cleanConcept = concept.trim();
  const cleanVendor = vendorName.trim();
  if (cleanConcept.length < 2 || cleanConcept.length > 200) {
    throw new Error('El concepto del gasto debe tener entre 2 y 200 caracteres.');
  }
  if (cleanVendor.length < 2 || cleanVendor.length > 160) {
    throw new Error('El nombre del proveedor o beneficiario debe tener entre 2 y 160 caracteres.');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('El monto del gasto debe ser mayor que cero.');
  }

  const id = generateId('exp');
  const expenseNumber = `GST-${expenseDate.replace(/-/g, '').slice(0, 6)}-${id.slice(-4).toUpperCase()}`;
  const rec: OperatingExpenseRecord = {
    id,
    organizationId,
    expenseNumber,
    expenseDate: expenseDate.slice(0, 10),
    category,
    concept: cleanConcept,
    vendorName: cleanVendor,
    invoiceNumber: invoiceNumber.trim().slice(0, 64),
    currency,
    amount: round2(amount),
    paymentMethod,
    status,
    notes: notes.trim().slice(0, 1000),
    createdBy: user.uid,
    createdByName: user.displayName,
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'operating_expenses', id), {
    ...rec,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId,
    eventType: 'OPERATING_EXPENSE_CREATED',
    entityType: 'operating_expenses',
    entityId: id,
    action: `Gasto registrado (${expenseNumber}) · ${currency} ${rec.amount.toFixed(2)}`,
    justification: `${cleanConcept} · ${cleanVendor} (${status})`,
    transactionId: id,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `operating_expenses/${id}`);
  }
  return rec;
}

export async function updateOperatingExpenseStatus(params: {
  expense: OperatingExpenseRecord;
  nextStatus: ExpenseStatus;
  paymentMethod?: ExpensePaymentMethod;
  notes?: string;
  user: UserProfile;
}): Promise<void> {
  const { expense, nextStatus, paymentMethod, notes, user } = params;
  if (!canManageOperations(user.role)) {
    throw new Error('Tu rol no tiene autorización para modificar gastos.');
  }
  if (expense.status === 'ANULADO') {
    throw new Error('Un gasto anulado es inmutable y no puede modificarse.');
  }

  const batch = writeBatch(db);
  const ref = doc(db, 'operating_expenses', expense.id);
  batch.update(ref, {
    status: nextStatus,
    paymentMethod: paymentMethod ?? expense.paymentMethod,
    notes: notes !== undefined ? notes.trim().slice(0, 1000) : expense.notes || '',
    updatedAt: serverTimestamp(),
  });

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: expense.organizationId,
    eventType: 'OPERATING_EXPENSE_UPDATED',
    entityType: 'operating_expenses',
    entityId: expense.id,
    action: `Gasto ${expense.expenseNumber} actualizado a ${nextStatus}`,
    justification: `${expense.concept} · ${expense.currency} ${expense.amount.toFixed(2)}`,
    transactionId: expense.id,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `operating_expenses/${expense.id}`);
  }
}

export async function createInvestorWithInitialCapital(params: {
  organizationId: string;
  fullName: string;
  investorType: InvestorType;
  documentNumber: string;
  phone: string;
  email?: string;
  currency: CurrencyCode;
  annualReturnRatePct: number;
  joinDate: string;
  initialCapitalAmount: number;
  paymentMethod: ExpensePaymentMethod;
  referenceNumber?: string;
  notes?: string;
  user: UserProfile;
}): Promise<{ investor: InvestorRecord; initialTx: InvestorTransactionRecord | null }> {
  const {
    organizationId,
    fullName,
    investorType,
    documentNumber,
    phone,
    email = '',
    currency,
    annualReturnRatePct,
    joinDate,
    initialCapitalAmount,
    paymentMethod,
    referenceNumber = '',
    notes = '',
    user,
  } = params;

  if (!canManageOperations(user.role)) {
    throw new Error('Tu rol no tiene autorización para registrar inversionistas.');
  }
  const cleanName = fullName.trim();
  const cleanDoc = documentNumber.trim();
  const cleanPhone = phone.trim();
  if (cleanName.length < 2 || cleanName.length > 160) {
    throw new Error('El nombre del inversionista debe tener entre 2 y 160 caracteres.');
  }
  if (cleanDoc.length < 4 || cleanDoc.length > 40) {
    throw new Error('La cédula o RNC debe tener entre 4 y 40 caracteres.');
  }
  if (cleanPhone.length < 7 || cleanPhone.length > 40) {
    throw new Error('El teléfono debe tener al menos 7 dígitos.');
  }
  if (!Number.isFinite(annualReturnRatePct) || annualReturnRatePct < 0 || annualReturnRatePct > 200) {
    throw new Error('La tasa anual de rendimiento debe estar entre 0% y 200%.');
  }
  if (!Number.isFinite(initialCapitalAmount) || initialCapitalAmount < 0) {
    throw new Error('El aporte inicial no puede ser negativo.');
  }

  const investorId = generateId('inv');
  const investorCode = `INV-${investorId.slice(-6).toUpperCase()}`;
  const cleanCapital = round2(initialCapitalAmount);

  const investor: InvestorRecord = {
    id: investorId,
    organizationId,
    investorCode,
    fullName: cleanName,
    investorType,
    documentNumber: cleanDoc,
    phone: cleanPhone,
    email: email.trim().slice(0, 254),
    currency,
    annualReturnRatePct: round2(annualReturnRatePct),
    joinDate: joinDate.slice(0, 10),
    currentInvestedBalance: cleanCapital,
    totalContributed: cleanCapital,
    totalWithdrawn: 0,
    totalReturnsPaid: 0,
    status: 'ACTIVO',
    notes: notes.trim().slice(0, 1000),
    createdBy: user.uid,
    createdByName: user.displayName,
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'investors', investorId), {
    ...investor,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  let initialTx: InvestorTransactionRecord | null = null;
  if (cleanCapital > 0) {
    const txId = generateId('invtx');
    initialTx = {
      id: txId,
      organizationId,
      investorId,
      investorName: cleanName,
      transactionType: 'APORTE_CAPITAL',
      transactionDate: joinDate.slice(0, 10),
      currency,
      amount: cleanCapital,
      paymentMethod,
      referenceNumber: (referenceNumber.trim() || investorCode).slice(0, 80),
      notes: 'Aporte inicial de capital al registrar inversionista',
      createdBy: user.uid,
      createdByName: user.displayName,
    };
    batch.set(doc(db, 'investor_transactions', txId), {
      ...initialTx,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId,
    eventType: 'INVESTOR_REGISTERED',
    entityType: 'investors',
    entityId: investorId,
    action: `Inversionista registrado (${investorCode}): ${cleanName}`,
    justification: `Capital inicial: ${currency} ${cleanCapital.toFixed(2)} · Rendimiento anual: ${annualReturnRatePct}%`,
    transactionId: investorId,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `investors/${investorId}`);
  }

  return { investor, initialTx };
}

export async function recordInvestorCapitalMovement(params: {
  investor: InvestorRecord;
  transactionType: InvestorTransactionType;
  transactionDate: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  referenceNumber?: string;
  notes?: string;
  user: UserProfile;
}): Promise<InvestorTransactionRecord> {
  const {
    investor,
    transactionType,
    transactionDate,
    amount,
    paymentMethod,
    referenceNumber = '',
    notes = '',
    user,
  } = params;

  if (!canManageOperations(user.role)) {
    throw new Error('Tu rol no tiene autorización para registrar movimientos de inversionistas.');
  }
  const cleanAmount = round2(amount);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    throw new Error('El monto de la operación debe ser mayor que cero.');
  }

  const txId = generateId('invtx');
  const txRecord: InvestorTransactionRecord = {
    id: txId,
    organizationId: investor.organizationId,
    investorId: investor.id,
    investorName: investor.fullName,
    transactionType,
    transactionDate: transactionDate.slice(0, 10),
    currency: investor.currency,
    amount: cleanAmount,
    paymentMethod,
    referenceNumber: (referenceNumber.trim() || txId.slice(-8).toUpperCase()).slice(0, 80),
    notes: notes.trim().slice(0, 1000),
    createdBy: user.uid,
    createdByName: user.displayName,
  };

  try {
    await runTransaction(db, async (tx) => {
      const invRef = doc(db, 'investors', investor.id);
      const snap = await tx.get(invRef);
      if (!snap.exists()) {
        throw new Error('El inversionista seleccionado no existe.');
      }
      const current = snap.data() as InvestorRecord;

      let nextBalance = current.currentInvestedBalance;
      let nextContributed = current.totalContributed;
      let nextWithdrawn = current.totalWithdrawn;
      let nextReturns = current.totalReturnsPaid;

      if (transactionType === 'APORTE_CAPITAL') {
        nextBalance = round2(current.currentInvestedBalance + cleanAmount);
        nextContributed = round2(current.totalContributed + cleanAmount);
      } else if (transactionType === 'RETIRO_CAPITAL') {
        if (cleanAmount > current.currentInvestedBalance + 0.005) {
          throw new Error(
            `El retiro (${investor.currency} ${cleanAmount.toFixed(2)}) excede el capital invertido disponible (${investor.currency} ${current.currentInvestedBalance.toFixed(2)}).`
          );
        }
        nextBalance = Math.max(0, round2(current.currentInvestedBalance - cleanAmount));
        nextWithdrawn = round2(current.totalWithdrawn + cleanAmount);
      } else {
        nextReturns = round2(current.totalReturnsPaid + cleanAmount);
      }

      tx.update(invRef, {
        currentInvestedBalance: nextBalance,
        totalContributed: nextContributed,
        totalWithdrawn: nextWithdrawn,
        totalReturnsPaid: nextReturns,
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, 'investor_transactions', txId), {
        ...txRecord,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const auditId = generateId('audit');
      tx.set(doc(db, 'audit_logs', auditId), {
        id: auditId,
        organizationId: investor.organizationId,
        eventType: 'INVESTOR_MOVEMENT_RECORDED',
        entityType: 'investor_transactions',
        entityId: txId,
        action: `${transactionType} · ${investor.fullName} · ${investor.currency} ${cleanAmount.toFixed(2)}`,
        justification: txRecord.notes || `Ref: ${txRecord.referenceNumber}`,
        transactionId: txId,
        userId: user.uid,
        userEmail: user.email,
        userRole: user.role,
        timestamp: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('excede el capital')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `investor_transactions/${txId}`);
  }

  return txRecord;
}

export async function toggleInvestorStatus(params: {
  investor: InvestorRecord;
  nextStatus: InvestorStatus;
  user: UserProfile;
}): Promise<void> {
  const { investor, nextStatus, user } = params;
  if (!canManageOperations(user.role)) {
    throw new Error('Tu rol no tiene autorización para actualizar inversionistas.');
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'investors', investor.id), {
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: investor.organizationId,
    eventType: 'INVESTOR_STATUS_UPDATED',
    entityType: 'investors',
    entityId: investor.id,
    action: `Inversionista ${investor.investorCode} actualizado a ${nextStatus}`,
    justification: investor.fullName,
    transactionId: investor.id,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `investors/${investor.id}`);
  }
}
