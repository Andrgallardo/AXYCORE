import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from '@xmldom/xmldom';
import {
  ECF_TYPE_META,
  type EcfTypeCode,
} from '../../types/dgiiEcf';
import {
  cleanDigits,
  isValidEncfFormat,
  round2,
  validateDominicanRnc,
  validateDominicanCedula,
} from './dgiiCatalogAndValidation';
import {
  BUILTIN_DGII_XSD_SCHEMAS,
  DGII_XSD_METADATA,
  ecfTypeToSchemaKind,
  type DgiiSchemaDocumentKind,
  type DgiiXsdSchemaMetadata,
} from './xsd/officialDgiiXsd';

export type { DgiiSchemaDocumentKind, DgiiXsdSchemaMetadata };

export interface XsdValidationIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  xpath: string;
  message: string;
  ruleSource: 'XML_SYNTAX' | 'XSD_SCHEMA' | 'LEY_32_23';
}

export interface XsdValidationResult {
  valid: boolean;
  schemaKind: DgiiSchemaDocumentKind;
  schemaFileName: string;
  schemaVersion: '1.0';
  rootElement: string;
  ecfType?: EcfTypeCode;
  errors: string[];
  warnings: string[];
  issues: XsdValidationIssue[];
  checksExecuted: string[];
  validatedAtIso: string;
}

export interface ValidateXmlOptions {
  /**
   * When false (default in validateEcfBeforeDigitalSignature), rejects XML that already contains <Signature>.
   * Set true when validating already-signed documents (e.g., incoming supplier e-CFs).
   */
  allowSignature?: boolean;
  /** Enforce Ley 32-23 cross-field semantic and arithmetic rules in addition to W3C XSD structure (default true). */
  enforceLey3223Rules?: boolean;
}

interface CompiledSimpleType {
  name: string;
  base: string;
  patterns: RegExp[];
  enumerations: string[];
  minLength?: number;
  maxLength?: number;
  totalDigits?: number;
  fractionDigits?: number;
  minInclusive?: number;
  maxInclusive?: number;
}

interface CompiledParticle {
  kind: 'element' | 'any';
  name: string;
  minOccurs: number;
  maxOccurs: number; // Infinity for unbounded
  typeName?: string;
  inlineSimpleType?: CompiledSimpleType;
  children?: CompiledParticle[]; // non-null for complexType sequence
}

export interface CompiledXsdSchema {
  metadata: DgiiXsdSchemaMetadata;
  rawXsd: string;
  source: 'EMBEDDED_OFFICIAL' | 'REGISTERED_RUNTIME';
  simpleTypes: Map<string, CompiledSimpleType>;
  rootParticle: CompiledParticle;
  totalElementDefinitions: number;
  loadedAtIso: string;
}

const runtimeSchemaRegistry = new Map<
  DgiiSchemaDocumentKind,
  { rawXsd: string; source: 'EMBEDDED_OFFICIAL' | 'REGISTERED_RUNTIME' }
>();
const compiledSchemaCache = new Map<DgiiSchemaDocumentKind, CompiledXsdSchema>();

function getElementChildren(node: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child && child.nodeType === 1) {
      out.push(child as XmlElement);
    }
  }
  return out;
}

function getLocalName(node: XmlElement): string {
  return node.localName || node.tagName.replace(/^[^:]+:/, '');
}

function getDirectChildByTag(parent: XmlElement, localTagName: string): XmlElement | null {
  for (const child of getElementChildren(parent)) {
    if (getLocalName(child) === localTagName) return child;
  }
  return null;
}

function getDirectChildrenByTag(parent: XmlElement, localTagName: string): XmlElement[] {
  return getElementChildren(parent).filter((c) => getLocalName(c) === localTagName);
}

function readTagText(parent: XmlElement, localTagName: string): string | null {
  const el = getDirectChildByTag(parent, localTagName);
  return el ? (el.textContent ?? '').trim() : null;
}

function parseXmlSafely(xml: string): { doc: XmlDocument | null; syntaxErrors: string[] } {
  const syntaxErrors: string[] = [];
  const trimmed = String(xml ?? '').trim();
  if (!trimmed) {
    return { doc: null, syntaxErrors: ['El documento XML está vacío.'] };
  }
  if (!trimmed.startsWith('<')) {
    return { doc: null, syntaxErrors: ['El contenido no comienza con un nodo XML válido (<).'] };
  }

  let parsed: XmlDocument | null = null;
  try {
    const parser = new DOMParser({
      onError: (level, msg) => {
        if (level === 'error' || level === 'fatalError') {
          syntaxErrors.push(String(msg).replace(/\s+/g, ' ').trim());
        }
      },
    });
    parsed = parser.parseFromString(trimmed, 'text/xml');
  } catch (err) {
    syntaxErrors.push(err instanceof Error ? err.message : 'Error sintáctico XML inesperado.');
  }

  if (!parsed || !parsed.documentElement) {
    if (syntaxErrors.length === 0) {
      syntaxErrors.push('No se pudo analizar el elemento raíz del documento XML.');
    }
    return { doc: null, syntaxErrors };
  }

  // Catch @xmldom parsererror nodes if emitted
  const parserErrorNodes = parsed.getElementsByTagName('parsererror');
  if (parserErrorNodes && parserErrorNodes.length > 0) {
    syntaxErrors.push(
      (parserErrorNodes[0].textContent || 'XML mal formado según analizador DOM.').trim()
    );
  }

  return { doc: parsed, syntaxErrors };
}

function parseSimpleTypeNode(node: XmlElement, nameOverride?: string): CompiledSimpleType {
  const name = nameOverride || node.getAttribute('name') || '(inline)';
  const restriction = getDirectChildByTag(node, 'restriction');
  const base = restriction?.getAttribute('base') || 'xs:string';
  const compiled: CompiledSimpleType = {
    name,
    base,
    patterns: [],
    enumerations: [],
  };

  if (!restriction) return compiled;

  for (const facet of getElementChildren(restriction)) {
    const facetName = getLocalName(facet);
    const val = facet.getAttribute('value') ?? '';
    switch (facetName) {
      case 'pattern':
        try {
          compiled.patterns.push(new RegExp(`^(?:${val})$`));
        } catch {
          // Ignore malformed regex facet safely
        }
        break;
      case 'enumeration':
        compiled.enumerations.push(val);
        break;
      case 'minLength':
        compiled.minLength = Number(val);
        break;
      case 'maxLength':
        compiled.maxLength = Number(val);
        break;
      case 'totalDigits':
        compiled.totalDigits = Number(val);
        break;
      case 'fractionDigits':
        compiled.fractionDigits = Number(val);
        break;
      case 'minInclusive':
        compiled.minInclusive = Number(val);
        break;
      case 'maxInclusive':
        compiled.maxInclusive = Number(val);
        break;
      default:
        break;
    }
  }
  return compiled;
}

function parseOccursAttr(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue;
  if (value === 'unbounded') return Number.POSITIVE_INFINITY;
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

function compileElementParticle(
  elNode: XmlElement,
  counter: { count: number }
): CompiledParticle {
  counter.count += 1;
  const name = elNode.getAttribute('name') || '';
  const typeName = elNode.getAttribute('type') || undefined;
  const minOccurs = parseOccursAttr(elNode.getAttribute('minOccurs'), 1);
  const maxOccurs = parseOccursAttr(elNode.getAttribute('maxOccurs'), 1);

  const inlineComplex = getDirectChildByTag(elNode, 'complexType');
  const inlineSimple = getDirectChildByTag(elNode, 'simpleType');

  let children: CompiledParticle[] | undefined;
  if (inlineComplex) {
    children = [];
    const sequence = getDirectChildByTag(inlineComplex, 'sequence');
    if (sequence) {
      for (const seqChild of getElementChildren(sequence)) {
        const local = getLocalName(seqChild);
        if (local === 'element') {
          children.push(compileElementParticle(seqChild, counter));
        } else if (local === 'any') {
          children.push({
            kind: 'any',
            name: '*',
            minOccurs: parseOccursAttr(seqChild.getAttribute('minOccurs'), 1),
            maxOccurs: parseOccursAttr(seqChild.getAttribute('maxOccurs'), 1),
          });
        }
      }
    }
  }

  return {
    kind: 'element',
    name,
    minOccurs,
    maxOccurs,
    typeName,
    inlineSimpleType: inlineSimple ? parseSimpleTypeNode(inlineSimple, `${name}_Inline`) : undefined,
    children,
  };
}

function compileXsdDocument(
  kind: DgiiSchemaDocumentKind,
  rawXsd: string,
  source: 'EMBEDDED_OFFICIAL' | 'REGISTERED_RUNTIME'
): CompiledXsdSchema {
  const { doc, syntaxErrors } = parseXmlSafely(rawXsd);
  if (!doc || !doc.documentElement || syntaxErrors.length > 0) {
    throw new Error(
      `El esquema XSD "${kind}" no es XML válido: ${syntaxErrors.join(' | ')}`
    );
  }

  const schemaRoot = doc.documentElement;
  if (getLocalName(schemaRoot) !== 'schema') {
    throw new Error(`El archivo XSD "${kind}" no contiene el nodo raíz <xs:schema>.`);
  }

  const simpleTypes = new Map<string, CompiledSimpleType>();
  for (const child of getElementChildren(schemaRoot)) {
    if (getLocalName(child) === 'simpleType') {
      const parsed = parseSimpleTypeNode(child);
      if (parsed.name) {
        simpleTypes.set(parsed.name, parsed);
      }
    }
  }

  const rootElements = getDirectChildrenByTag(schemaRoot, 'element');
  if (rootElements.length === 0) {
    throw new Error(`El esquema XSD "${kind}" no define ningún <xs:element> raíz.`);
  }

  const counter = { count: 0 };
  const rootParticle = compileElementParticle(rootElements[0], counter);

  return {
    metadata: DGII_XSD_METADATA[kind],
    rawXsd,
    source,
    simpleTypes,
    rootParticle,
    totalElementDefinitions: counter.count,
    loadedAtIso: new Date().toISOString(),
  };
}

/**
 * Registers or overrides an official DGII W3C XSD schema at runtime (e.g., from disk or DGII download).
 */
export function registerDgiiXsdSchema(
  kind: DgiiSchemaDocumentKind,
  xsdXmlContent: string
): CompiledXsdSchema {
  const compiled = compileXsdDocument(kind, xsdXmlContent, 'REGISTERED_RUNTIME');
  runtimeSchemaRegistry.set(kind, {
    rawXsd: xsdXmlContent,
    source: 'REGISTERED_RUNTIME',
  });
  compiledSchemaCache.set(kind, compiled);
  return compiled;
}

/**
 * Loads and compiles an official DGII XSD schema by document kind.
 * Uses cached compiled AST unless forceReload=true.
 */
export function loadDgiiXsdSchema(
  kind: DgiiSchemaDocumentKind,
  forceReload = false
): CompiledXsdSchema {
  if (!forceReload) {
    const cached = compiledSchemaCache.get(kind);
    if (cached) return cached;
  }

  const registered = runtimeSchemaRegistry.get(kind);
  if (registered) {
    const compiled = compileXsdDocument(kind, registered.rawXsd, registered.source);
    compiledSchemaCache.set(kind, compiled);
    return compiled;
  }

  const builtin = BUILTIN_DGII_XSD_SCHEMAS[kind];
  if (!builtin) {
    throw new Error(`Esquema XSD DGII no encontrado para el tipo "${kind}".`);
  }

  const compiled = compileXsdDocument(kind, builtin, 'EMBEDDED_OFFICIAL');
  compiledSchemaCache.set(kind, compiled);
  return compiled;
}

/**
 * Browser-friendly async loader that fetches official `.xsd` files served from `/dgii-xsd/*.xsd`
 * and compiles them into the runtime validator registry.
 */
export async function fetchAndRegisterDgiiXsdSchemas(
  baseUrl = '/dgii-xsd'
): Promise<{ loaded: DgiiSchemaDocumentKind[]; failed: DgiiSchemaDocumentKind[] }> {
  const loaded: DgiiSchemaDocumentKind[] = [];
  const failed: DgiiSchemaDocumentKind[] = [];
  const kinds = Object.keys(DGII_XSD_METADATA) as DgiiSchemaDocumentKind[];

  await Promise.all(
    kinds.map(async (kind) => {
      const meta = DGII_XSD_METADATA[kind];
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/${meta.fileName}`);
        if (!res.ok) {
          failed.push(kind);
          return;
        }
        const xsdText = await res.text();
        registerDgiiXsdSchema(kind, xsdText);
        loaded.push(kind);
      } catch {
        failed.push(kind);
      }
    })
  );

  return { loaded, failed };
}

/**
 * Lists metadata and compilation stats for all 14 official DGII XSD schemas (10 e-CF + 4 auxiliary).
 */
export function listLoadedDgiiXsdSchemas(): Array<
  DgiiXsdSchemaMetadata & {
    loaded: boolean;
    source: 'EMBEDDED_OFFICIAL' | 'REGISTERED_RUNTIME';
    elementDefinitions: number;
    simpleTypeCount: number;
  }
> {
  return (Object.keys(DGII_XSD_METADATA) as DgiiSchemaDocumentKind[]).map((kind) => {
    const compiled = loadDgiiXsdSchema(kind);
    return {
      ...compiled.metadata,
      loaded: true,
      source: compiled.source,
      elementDefinitions: compiled.totalElementDefinitions,
      simpleTypeCount: compiled.simpleTypes.size,
    };
  });
}

function validateSimpleValue(
  value: string,
  xpath: string,
  schema: CompiledXsdSchema,
  typeName: string | undefined,
  inlineType: CompiledSimpleType | undefined,
  issues: XsdValidationIssue[]
): void {
  const simpleType =
    inlineType || (typeName ? schema.simpleTypes.get(typeName.replace(/^[^:]+:/, '')) : undefined);
  const primitive = simpleType?.base || typeName || 'xs:string';

  if (primitive === 'xs:integer') {
    if (!/^-?\d+$/.test(value)) {
      issues.push({
        severity: 'ERROR',
        code: 'XSD_TYPE_INTEGER',
        xpath,
        message: `El campo ${xpath} debe ser un número entero válido (recibido: "${value || 'vacío'}").`,
        ruleSource: 'XSD_SCHEMA',
      });
      return;
    }
  } else if (primitive === 'xs:decimal') {
    if (!/^-?\d+(\.\d+)?$/.test(value)) {
      issues.push({
        severity: 'ERROR',
        code: 'XSD_TYPE_DECIMAL',
        xpath,
        message: `El campo ${xpath} debe ser un decimal numérico válido (recibido: "${value || 'vacío'}").`,
        ruleSource: 'XSD_SCHEMA',
      });
      return;
    }
  }

  if (!simpleType) return;

  if (simpleType.minLength !== undefined && value.length < simpleType.minLength) {
    issues.push({
      severity: 'ERROR',
      code: 'XSD_FACET_MIN_LENGTH',
      xpath,
      message: `${xpath} requiere al menos ${simpleType.minLength} carácter(es).`,
      ruleSource: 'XSD_SCHEMA',
    });
  }

  if (simpleType.maxLength !== undefined && value.length > simpleType.maxLength) {
    issues.push({
      severity: 'ERROR',
      code: 'XSD_FACET_MAX_LENGTH',
      xpath,
      message: `${xpath} excede la longitud máxima XSD (${value.length} > ${simpleType.maxLength}).`,
      ruleSource: 'XSD_SCHEMA',
    });
  }

  if (simpleType.enumerations.length > 0 && !simpleType.enumerations.includes(value)) {
    issues.push({
      severity: 'ERROR',
      code: 'XSD_FACET_ENUMERATION',
      xpath,
      message: `Valor "${value}" inválido en ${xpath}. Permitidos por XSD: [${simpleType.enumerations.join(', ')}].`,
      ruleSource: 'XSD_SCHEMA',
    });
  }

  for (const pattern of simpleType.patterns) {
    if (!pattern.test(value)) {
      issues.push({
        severity: 'ERROR',
        code: 'XSD_FACET_PATTERN',
        xpath,
        message: `El valor "${value}" en ${xpath} no cumple el patrón oficial XSD (${pattern.source}).`,
        ruleSource: 'XSD_SCHEMA',
      });
    }
  }

  if (primitive === 'xs:decimal' || primitive === 'xs:integer') {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      issues.push({
        severity: 'ERROR',
        code: 'XSD_NUMERIC_NAN',
        xpath,
        message: `El valor "${value}" en ${xpath} no es numérico válido.`,
        ruleSource: 'XSD_SCHEMA',
      });
      return;
    }
    if (simpleType.minInclusive !== undefined && num < simpleType.minInclusive) {
      issues.push({
        severity: 'ERROR',
        code: 'XSD_FACET_MIN_INCLUSIVE',
        xpath,
        message: `${xpath} (${value}) debe ser >= ${simpleType.minInclusive}.`,
        ruleSource: 'XSD_SCHEMA',
      });
    }
    if (simpleType.maxInclusive !== undefined && num > simpleType.maxInclusive) {
      issues.push({
        severity: 'ERROR',
        code: 'XSD_FACET_MAX_INCLUSIVE',
        xpath,
        message: `${xpath} (${value}) debe ser <= ${simpleType.maxInclusive}.`,
        ruleSource: 'XSD_SCHEMA',
      });
    }
    if (simpleType.fractionDigits !== undefined && value.includes('.')) {
      const decimals = value.split('.')[1]?.length || 0;
      if (decimals > simpleType.fractionDigits) {
        issues.push({
          severity: 'ERROR',
          code: 'XSD_FACET_FRACTION_DIGITS',
          xpath,
          message: `${xpath} admite máximo ${simpleType.fractionDigits} decimales (recibidos ${decimals}).`,
          ruleSource: 'XSD_SCHEMA',
        });
      }
    }
    if (simpleType.totalDigits !== undefined) {
      const digitsOnly = value.replace(/[^0-9]/g, '');
      if (digitsOnly.length > simpleType.totalDigits) {
        issues.push({
          severity: 'ERROR',
          code: 'XSD_FACET_TOTAL_DIGITS',
          xpath,
          message: `${xpath} excede el máximo de ${simpleType.totalDigits} dígitos totales XSD.`,
          ruleSource: 'XSD_SCHEMA',
        });
      }
    }
  }
}

function validateElementAgainstParticle(
  xmlEl: XmlElement,
  particle: CompiledParticle,
  xpath: string,
  schema: CompiledXsdSchema,
  issues: XsdValidationIssue[]
): void {
  if (!particle.children) {
    // Leaf / simple element
    const nestedChildren = getElementChildren(xmlEl);
    if (nestedChildren.length > 0) {
      issues.push({
        severity: 'ERROR',
        code: 'XSD_UNEXPECTED_CHILD_IN_SIMPLE',
        xpath,
        message: `El elemento simple ${xpath} no debe contener subelementos XML (${getLocalName(nestedChildren[0])}).`,
        ruleSource: 'XSD_SCHEMA',
      });
      return;
    }
    const textVal = (xmlEl.textContent ?? '').trim();
    validateSimpleValue(
      textVal,
      xpath,
      schema,
      particle.typeName,
      particle.inlineSimpleType,
      issues
    );
    return;
  }

  // Complex element with ordered <xs:sequence>
  const actualChildren = getElementChildren(xmlEl);
  let childCursor = 0;

  for (const seqItem of particle.children) {
    if (seqItem.kind === 'any') {
      let matchedAny = 0;
      while (childCursor < actualChildren.length && matchedAny < seqItem.maxOccurs) {
        childCursor += 1;
        matchedAny += 1;
      }
      if (matchedAny < seqItem.minOccurs) {
        issues.push({
          severity: 'ERROR',
          code: 'XSD_MISSING_ANY',
          xpath,
          message: `Falta elemento requerido en secuencia de ${xpath}.`,
          ruleSource: 'XSD_SCHEMA',
        });
      }
      continue;
    }

    let matched = 0;
    while (
      childCursor < actualChildren.length &&
      getLocalName(actualChildren[childCursor]) === seqItem.name &&
      matched < seqItem.maxOccurs
    ) {
      const childEl = actualChildren[childCursor];
      const childXpath =
        seqItem.maxOccurs > 1 ? `${xpath}/${seqItem.name}[${matched + 1}]` : `${xpath}/${seqItem.name}`;
      validateElementAgainstParticle(childEl, seqItem, childXpath, schema, issues);
      childCursor += 1;
      matched += 1;
    }

    if (matched < seqItem.minOccurs) {
      const laterMatchIdx = actualChildren
        .slice(childCursor)
        .findIndex((c) => getLocalName(c) === seqItem.name);
      if (laterMatchIdx !== -1) {
        issues.push({
          severity: 'ERROR',
          code: 'XSD_SEQUENCE_ORDER',
          xpath: `${xpath}/${seqItem.name}`,
          message: `Elemento <${seqItem.name}> fuera de orden de secuencia <xs:sequence> dentro de ${xpath}.`,
          ruleSource: 'XSD_SCHEMA',
        });
      } else {
        issues.push({
          severity: 'ERROR',
          code: 'XSD_MISSING_REQUIRED_ELEMENT',
          xpath: `${xpath}/${seqItem.name}`,
          message: `Falta elemento obligatorio <${seqItem.name}> en ${xpath} según esquema ${schema.metadata.fileName}.`,
          ruleSource: 'XSD_SCHEMA',
        });
      }
    }

    // Check excess occurrences beyond maxOccurs
    while (
      childCursor < actualChildren.length &&
      getLocalName(actualChildren[childCursor]) === seqItem.name
    ) {
      issues.push({
        severity: 'ERROR',
        code: 'XSD_MAX_OCCURS_EXCEEDED',
        xpath: `${xpath}/${seqItem.name}`,
        message: `El elemento <${seqItem.name}> en ${xpath} supera el máximo permitido (${seqItem.maxOccurs}).`,
        ruleSource: 'XSD_SCHEMA',
      });
      childCursor += 1;
    }
  }

  // Flag any trailing unexpected / unknown XML tags
  while (childCursor < actualChildren.length) {
    const extraEl = actualChildren[childCursor];
    const extraName = getLocalName(extraEl);
    issues.push({
      severity: 'ERROR',
      code: 'XSD_UNEXPECTED_ELEMENT',
      xpath: `${xpath}/${extraName}`,
      message: `Elemento <${extraName}> no permitido o fuera de posición en ${xpath} según ${schema.metadata.fileName}.`,
      ruleSource: 'XSD_SCHEMA',
    });
    childCursor += 1;
  }
}

function validateLey3223FiscalRules(
  root: XmlElement,
  schemaKind: DgiiSchemaDocumentKind,
  ecfType: EcfTypeCode | undefined,
  options: ValidateXmlOptions,
  issues: XsdValidationIssue[],
  checksExecuted: string[]
): void {
  const sigNodes = root.getElementsByTagName('Signature');
  const hasSignature = sigNodes && sigNodes.length > 0;
  if (options.allowSignature === false && hasSignature) {
    issues.push({
      severity: 'ERROR',
      code: 'PRE_SIGN_ALREADY_SIGNED',
      xpath: `/${getLocalName(root)}/Signature`,
      message:
        'El documento XML ya contiene un nodo <Signature>; la validación previa a la firma exige un XML sin firma digital incrustada.',
      ruleSource: 'LEY_32_23',
    });
  }

  if (schemaKind === 'RFCE' || schemaKind === 'ACECF' || schemaKind === 'ARECF' || schemaKind === 'ANECF') {
    const rncEmisor =
      readTagText(root, 'RNCEmisor') ||
      (() => {
        const enc = getDirectChildByTag(root, 'Encabezado');
        if (enc) {
          const emisorEl = getDirectChildByTag(enc, 'Emisor');
          if (emisorEl) {
            const r = readTagText(emisorEl, 'RNCEmisor');
            if (r) return r;
          }
          return readTagText(enc, 'RNCEmisor') || readTagText(enc, 'RncEmisor');
        }
        const det =
          getDirectChildByTag(root, 'DetalleAprobacionComercial') ||
          getDirectChildByTag(root, 'DetalleAcusedeRecibo');
        return det ? readTagText(det, 'RNCEmisor') : null;
      })();

    if (rncEmisor) {
      checksExecuted.push('Dígito verificador RNC Emisor (DGII Mod-11)');
      const rncCheck = validateDominicanRnc(cleanDigits(rncEmisor));
      if (!rncCheck.valid) {
        issues.push({
          severity: 'ERROR',
          code: 'LEY3223_INVALID_ISSUER_RNC',
          xpath: `/${getLocalName(root)}/.../RNCEmisor`,
          message: `RNC del emisor inválido (${rncEmisor}): ${rncCheck.reason || 'dígito verificador incorrecto'}.`,
          ruleSource: 'LEY_32_23',
        });
      }
    }
    return;
  }

  const encabezado = getDirectChildByTag(root, 'Encabezado');
  const idDoc = encabezado ? getDirectChildByTag(encabezado, 'IdDoc') : null;
  const emisor = encabezado ? getDirectChildByTag(encabezado, 'Emisor') : null;
  const comprador = encabezado ? getDirectChildByTag(encabezado, 'Comprador') : null;
  const totales = encabezado ? getDirectChildByTag(encabezado, 'Totales') : null;
  const detalles = getDirectChildByTag(root, 'DetallesItems');
  const infoRef = getDirectChildByTag(root, 'InformacionReferencia');

  // 1. TipoeCF <-> eNCF prefix coherence
  checksExecuted.push('Coherencia TipoeCF con prefijo oficial de e-NCF');
  const tipoEcf = idDoc ? readTagText(idDoc, 'TipoeCF') : null;
  const encf = idDoc ? readTagText(idDoc, 'eNCF') : null;
  if (tipoEcf && encf && !isValidEncfFormat(encf, tipoEcf as EcfTypeCode)) {
    issues.push({
      severity: 'ERROR',
      code: 'LEY3223_ENCF_TYPE_MISMATCH',
      xpath: '/ECF/Encabezado/IdDoc/eNCF',
      message: `El e-NCF "${encf}" no corresponde al TipoeCF="${tipoEcf}" (debe iniciar con E${tipoEcf} + 10 dígitos).`,
      ruleSource: 'LEY_32_23',
    });
  }

  // 2. Issuer RNC check digit
  checksExecuted.push('Validación dígito verificador RNCEmisor (DGII Mod-11 / Mod-10)');
  const rncEmisor = emisor ? readTagText(emisor, 'RNCEmisor') : null;
  if (rncEmisor) {
    const digits = cleanDigits(rncEmisor);
    const validIssuer =
      digits.length === 11
        ? validateDominicanCedula(digits).valid
        : validateDominicanRnc(digits).valid;
    if (!validIssuer) {
      issues.push({
        severity: 'ERROR',
        code: 'LEY3223_INVALID_ISSUER_RNC',
        xpath: '/ECF/Encabezado/Emisor/RNCEmisor',
        message: `RNCEmisor "${rncEmisor}" no supera la validación de dígito verificador oficial DGII.`,
        ruleSource: 'LEY_32_23',
      });
    }
  }

  // 3. Buyer RNC / Cedula check digit & E32 >= RD$250,000 / E41 rules
  checksExecuted.push('Reglas fiscales de identificación del Comprador / Proveedor');
  const rncComprador = comprador ? readTagText(comprador, 'RNCComprador') : null;
  const extId = comprador ? readTagText(comprador, 'IdentificadorExtranjero') : null;
  if (rncComprador) {
    const digits = cleanDigits(rncComprador);
    const validBuyer =
      digits.length === 11
        ? validateDominicanCedula(digits).valid
        : validateDominicanRnc(digits).valid;
    if (!validBuyer) {
      issues.push({
        severity: 'ERROR',
        code: 'LEY3223_INVALID_BUYER_RNC',
        xpath: '/ECF/Encabezado/Comprador/RNCComprador',
        message: `RNCComprador "${rncComprador}" no supera la validación oficial Mod-11/Mod-10 de la DGII.`,
        ruleSource: 'LEY_32_23',
      });
    }
  }

  const montoTotal = totales ? Number(readTagText(totales, 'MontoTotal') || 0) : 0;
  if (ecfType === '32' && montoTotal >= 250000 && !rncComprador && !extId) {
    issues.push({
      severity: 'ERROR',
      code: 'LEY3223_E32_THRESHOLD_ID',
      xpath: '/ECF/Encabezado/Comprador',
      message:
        'Ley 32-23 / Norma 06-2018: Factura de Consumo (32) >= RD$250,000 requiere RNCComprador o IdentificadorExtranjero del cliente.',
      ruleSource: 'LEY_32_23',
    });
  }

  if (ecfType === '41' && !rncComprador && !extId) {
    issues.push({
      severity: 'ERROR',
      code: 'LEY3223_E41_SUPPLIER_ID',
      xpath: '/ECF/Encabezado/Comprador',
      message:
        'Comprobante de Compras (41) requiere RNCComprador o IdentificadorExtranjero (Cédula) del proveedor no registrado.',
      ruleSource: 'LEY_32_23',
    });
  }

  // 4. Notes 33/34 reference check
  if (ecfType === '33' || ecfType === '34') {
    checksExecuted.push('Referencia NCFModificado obligatoria en Notas de Débito/Crédito (33/34)');
    const modNcf = infoRef ? readTagText(infoRef, 'NCFModificado') : null;
    if (!modNcf || (!isValidEncfFormat(modNcf) && !/^B\d{10}$/.test(modNcf))) {
      issues.push({
        severity: 'ERROR',
        code: 'LEY3223_INVALID_REF_NCF',
        xpath: '/ECF/InformacionReferencia/NCFModificado',
        message: `El e-CF ${ecfType} requiere <NCFModificado> con formato válido (E + 12 dígitos o B + 10 dígitos).`,
        ruleSource: 'LEY_32_23',
      });
    }
  }

  // 5. Special exempt/zero-ITBIS regime rules (43, 44, 46, 47)
  const totalItbis = totales ? Number(readTagText(totales, 'TotalITBIS') || 0) : 0;
  if (ecfType && ECF_TYPE_META[ecfType] && !ECF_TYPE_META[ecfType].allowsItbis && totalItbis > 0) {
    issues.push({
      severity: 'ERROR',
      code: 'LEY3223_DISALLOWED_ITBIS',
      xpath: '/ECF/Encabezado/Totales/TotalITBIS',
      message: `El e-CF tipo ${ecfType} (${ECF_TYPE_META[ecfType].name}) no admite facturación de ITBIS positivo (TotalITBIS=${totalItbis.toFixed(2)}).`,
      ruleSource: 'LEY_32_23',
    });
  }

  // 6. Arithmetic reconciliation between <DetallesItems> and <Totales>/<MontoTotal>
  if (detalles && totales) {
    checksExecuted.push('Cuadre aritmético entre <DetallesItems> y <Totales>/<MontoTotal>');
    const itemEls = getDirectChildrenByTag(detalles, 'Item');
    let sumSubtotal = 0;
    let sumItbis = 0;
    let sumOtherTax = 0;

    itemEls.forEach((itemEl, idx) => {
      const montoItem = Number(readTagText(itemEl, 'MontoItem') || 0);
      const montoItbis = Number(readTagText(itemEl, 'MontoITBIS') || 0);
      const montoOtros = Number(readTagText(itemEl, 'MontoOtrosImpuestos') || 0);
      const lineNo = Number(readTagText(itemEl, 'NumeroLinea') || 0);
      if (lineNo !== idx + 1) {
        issues.push({
          severity: 'WARNING',
          code: 'LEY3223_NON_SEQUENTIAL_LINE',
          xpath: `/ECF/DetallesItems/Item[${idx + 1}]/NumeroLinea`,
          message: `NumeroLinea=${lineNo} no es secuencial respecto a la posición ${idx + 1}.`,
          ruleSource: 'LEY_32_23',
        });
      }
      sumSubtotal = round2(sumSubtotal + montoItem);
      sumItbis = round2(sumItbis + montoItbis);
      sumOtherTax = round2(sumOtherTax + montoOtros);
    });

    const expectedTotal = round2(sumSubtotal + sumItbis + sumOtherTax);
    if (Math.abs(expectedTotal - montoTotal) > 0.1) {
      issues.push({
        severity: 'ERROR',
        code: 'LEY3223_TOTAL_MISMATCH',
        xpath: '/ECF/Encabezado/Totales/MontoTotal',
        message: `Descuadre aritmético Ley 32-23: suma de líneas e impuestos (${expectedTotal.toFixed(2)}) no coincide con MontoTotal (${montoTotal.toFixed(2)}).`,
        ruleSource: 'LEY_32_23',
      });
    }
    if (Math.abs(sumItbis - totalItbis) > 0.1) {
      issues.push({
        severity: 'ERROR',
        code: 'LEY3223_ITBIS_MISMATCH',
        xpath: '/ECF/Encabezado/Totales/TotalITBIS',
        message: `Descuadre de ITBIS: suma de MontoITBIS en ítems (${sumItbis.toFixed(2)}) difiere de TotalITBIS (${totalItbis.toFixed(2)}).`,
        ruleSource: 'LEY_32_23',
      });
    }
  }
}

function detectSchemaKindFromDom(
  root: XmlElement,
  expectedKind?: DgiiSchemaDocumentKind | EcfTypeCode
): { schemaKind: DgiiSchemaDocumentKind; ecfType?: EcfTypeCode; mismatchError?: string } {
  const rootTag = getLocalName(root);
  const normalizedExpected: DgiiSchemaDocumentKind | undefined = expectedKind
    ? expectedKind.length === 2
      ? ecfTypeToSchemaKind(expectedKind as EcfTypeCode)
      : (expectedKind as DgiiSchemaDocumentKind)
    : undefined;

  if (rootTag === 'RFCE') {
    return {
      schemaKind: 'RFCE',
      ecfType: '32',
      mismatchError:
        normalizedExpected && normalizedExpected !== 'RFCE'
          ? `Se esperaba esquema ${normalizedExpected}, pero la raíz XML es <RFCE>.`
          : undefined,
    };
  }
  if (rootTag === 'ACECF') {
    return {
      schemaKind: 'ACECF',
      mismatchError:
        normalizedExpected && normalizedExpected !== 'ACECF'
          ? `Se esperaba esquema ${normalizedExpected}, pero la raíz XML es <ACECF>.`
          : undefined,
    };
  }
  if (rootTag === 'ARECF') {
    return {
      schemaKind: 'ARECF',
      mismatchError:
        normalizedExpected && normalizedExpected !== 'ARECF'
          ? `Se esperaba esquema ${normalizedExpected}, pero la raíz XML es <ARECF>.`
          : undefined,
    };
  }
  if (rootTag === 'ANECF') {
    return {
      schemaKind: 'ANECF',
      mismatchError:
        normalizedExpected && normalizedExpected !== 'ANECF'
          ? `Se esperaba esquema ${normalizedExpected}, pero la raíz XML es <ANECF>.`
          : undefined,
    };
  }

  if (rootTag === 'ECF') {
    const enc = getDirectChildByTag(root, 'Encabezado');
    const idDoc = enc ? getDirectChildByTag(enc, 'IdDoc') : null;
    const xmlType = (idDoc ? readTagText(idDoc, 'TipoeCF') : null) as EcfTypeCode | null;
    if (xmlType && ECF_TYPE_META[xmlType]) {
      const detectedKind = ecfTypeToSchemaKind(xmlType);
      return {
        schemaKind: normalizedExpected?.startsWith('ECF_') ? normalizedExpected : detectedKind,
        ecfType: xmlType,
        mismatchError:
          normalizedExpected && normalizedExpected !== detectedKind
            ? `El XML declara TipoeCF=${xmlType}, distinto al esquema esperado (${normalizedExpected}).`
            : undefined,
      };
    }
    const fallbackKind = normalizedExpected?.startsWith('ECF_') ? normalizedExpected : 'ECF_31';
    return {
      schemaKind: fallbackKind,
      ecfType: DGII_XSD_METADATA[fallbackKind].ecfType,
    };
  }

  const fallback = normalizedExpected || 'ECF_31';
  return {
    schemaKind: fallback,
    ecfType: DGII_XSD_METADATA[fallback].ecfType,
    mismatchError: `Elemento raíz XML no reconocido por DGII: <${rootTag}> (esperado <${DGII_XSD_METADATA[fallback].rootElement}>).`,
  };
}

/**
 * Validates any DGII e-CF or auxiliary XML document against its official compiled W3C XSD schema
 * and Ley 32-23 cross-field fiscal compliance rules.
 */
export function validateXmlAgainstDgiiXsd(
  xml: string,
  expectedKind?: DgiiSchemaDocumentKind | EcfTypeCode,
  options: ValidateXmlOptions = {}
): XsdValidationResult {
  const issues: XsdValidationIssue[] = [];
  const checksExecuted: string[] = [];
  const validatedAtIso = new Date().toISOString();

  checksExecuted.push('Análisis sintáctico XML 1.0 (DOMParser)');
  const { doc, syntaxErrors } = parseXmlSafely(xml);

  if (!doc || !doc.documentElement || syntaxErrors.length > 0) {
    for (const msg of syntaxErrors) {
      issues.push({
        severity: 'ERROR',
        code: 'XML_SYNTAX_ERROR',
        xpath: '/',
        message: msg,
        ruleSource: 'XML_SYNTAX',
      });
    }
    const fallbackKind: DgiiSchemaDocumentKind = expectedKind
      ? expectedKind.length === 2
        ? ecfTypeToSchemaKind(expectedKind as EcfTypeCode)
        : (expectedKind as DgiiSchemaDocumentKind)
      : 'ECF_31';
    return {
      valid: false,
      schemaKind: fallbackKind,
      schemaFileName: DGII_XSD_METADATA[fallbackKind].fileName,
      schemaVersion: '1.0',
      rootElement: DGII_XSD_METADATA[fallbackKind].rootElement,
      ecfType: DGII_XSD_METADATA[fallbackKind].ecfType,
      errors: issues.filter((i) => i.severity === 'ERROR').map((i) => i.message),
      warnings: issues.filter((i) => i.severity === 'WARNING').map((i) => i.message),
      issues,
      checksExecuted,
      validatedAtIso,
    };
  }

  const root = doc.documentElement;
  const detection = detectSchemaKindFromDom(root, expectedKind);
  if (detection.mismatchError) {
    issues.push({
      severity: 'ERROR',
      code: 'XSD_DOCUMENT_KIND_MISMATCH',
      xpath: `/${getLocalName(root)}`,
      message: detection.mismatchError,
      ruleSource: 'XSD_SCHEMA',
    });
  }

  const schema = loadDgiiXsdSchema(detection.schemaKind);
  checksExecuted.push(
    `Validación estructural contra esquema oficial ${schema.metadata.fileName} (${schema.totalElementDefinitions} nodos XSD)`
  );

  if (getLocalName(root) === schema.rootParticle.name) {
    validateElementAgainstParticle(
      root,
      schema.rootParticle,
      `/${schema.rootParticle.name}`,
      schema,
      issues
    );
  }

  if (options.enforceLey3223Rules !== false) {
    validateLey3223FiscalRules(
      root,
      detection.schemaKind,
      detection.ecfType,
      options,
      issues,
      checksExecuted
    );
  }

  const errors = issues.filter((i) => i.severity === 'ERROR').map((i) => i.message);
  const warnings = issues.filter((i) => i.severity === 'WARNING').map((i) => i.message);

  return {
    valid: errors.length === 0,
    schemaKind: detection.schemaKind,
    schemaFileName: schema.metadata.fileName,
    schemaVersion: '1.0',
    rootElement: schema.metadata.rootElement,
    ecfType: detection.ecfType,
    errors,
    warnings,
    issues,
    checksExecuted,
    validatedAtIso,
  };
}

/**
 * Mandatory pre-signature validation gate invoked prior to applying PKCS#12 XMLDSig signature.
 * Ensures XML strictly conforms to official DGII XSD v1.0, Ley 32-23 rules, and contains no prior <Signature>.
 */
export function validateEcfBeforeDigitalSignature(
  xml: string,
  expectedKind?: DgiiSchemaDocumentKind | EcfTypeCode
): XsdValidationResult {
  return validateXmlAgainstDgiiXsd(xml, expectedKind, {
    allowSignature: false,
    enforceLey3223Rules: true,
  });
}
