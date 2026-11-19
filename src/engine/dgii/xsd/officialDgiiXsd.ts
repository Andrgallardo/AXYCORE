import type { EcfTypeCode } from '../../../types/dgiiEcf';

export type DgiiSchemaDocumentKind =
  | 'ECF_31'
  | 'ECF_32'
  | 'ECF_33'
  | 'ECF_34'
  | 'ECF_41'
  | 'ECF_43'
  | 'ECF_44'
  | 'ECF_45'
  | 'ECF_46'
  | 'ECF_47'
  | 'RFCE'
  | 'ACECF'
  | 'ARECF'
  | 'ANECF';

export interface DgiiXsdSchemaMetadata {
  kind: DgiiSchemaDocumentKind;
  fileName: string;
  rootElement: 'ECF' | 'RFCE' | 'ACECF' | 'ARECF' | 'ANECF';
  version: '1.0';
  ecfType?: EcfTypeCode;
  title: string;
  sourceSpec: string;
}

export const DGII_XSD_METADATA: Record<DgiiSchemaDocumentKind, DgiiXsdSchemaMetadata> = {
  ECF_31: {
    kind: 'ECF_31',
    fileName: 'e-CF_31_v.1.0.xsd',
    rootElement: 'ECF',
    version: '1.0',
    ecfType: '31',
    title: 'Factura de Crédito Fiscal Electrónica (31)',
    sourceSpec: 'DGII Formato e-CF v1.0 · Ley 32-23',
  },
  ECF_32: {
    kind: 'ECF_32',
    fileName: 'e-CF_32_v.1.0.xsd',
    rootElement: 'ECF',
    version: '1.0',
    ecfType: '32',
    title: 'Factura de Consumo Electrónica (32)',
    sourceSpec: 'DGII Formato e-CF v1.0 · Ley 32-23',
  },
  ECF_33: {
    kind: 'ECF_33',
    fileName: 'e-CF_33_v.1.0.xsd',
    rootElement: 'ECF',
    version: '1.0',
    ecfType: '33',
    title: 'Nota de Débito Electrónica (33)',
    sourceSpec: 'DGII Formato e-CF v1.0 · Ley 32-23',
  },
  ECF_34: {
    kind: 'ECF_34',
    fileName: 'e-CF_34_v.1.0.xsd',
    rootElement: 'ECF',
    version: '1.0',
    ecfType: '34',
    title: 'Nota de Crédito Electrónica (34)',
    sourceSpec: 'DGII Formato e-CF v1.0 · Ley 32-23',
  },
  ECF_41: {
    kind: 'ECF_41',
    fileName: 'e-CF_41_v.1.0.xsd',
    rootElement: 'ECF',
    version: '1.0',
    ecfType: '41',
    title: 'Comprobante de Compras Electrónico (41)',
    sourceSpec: 'DGII Formato e-CF v1.0 · Ley 32-23',
  },
  ECF_43: {
    kind: 'ECF_43',
    fileName: 'e-CF_43_v.1.0.xsd',
    rootElement: 'ECF',
    version: '1.0',
    ecfType: '43',
    title: 'Comprobante de Gastos Menores Electrónico (43)',
    sourceSpec: 'DGII Formato e-CF v1.0 · Ley 32-23',
  },
  ECF_44: {
    kind: 'ECF_44',
    fileName: 'e-CF_44_v.1.0.xsd',
    rootElement: 'ECF',
    version: '1.0',
    ecfType: '44',
    title: 'Comprobante de Régimen Especial Electrónico (44)',
    sourceSpec: 'DGII Formato e-CF v1.0 · Ley 32-23',
  },
  ECF_45: {
    kind: 'ECF_45',
    fileName: 'e-CF_45_v.1.0.xsd',
    rootElement: 'ECF',
    version: '1.0',
    ecfType: '45',
    title: 'Comprobante Gubernamental Electrónico (45)',
    sourceSpec: 'DGII Formato e-CF v1.0 · Ley 32-23',
  },
  ECF_46: {
    kind: 'ECF_46',
    fileName: 'e-CF_46_v.1.0.xsd',
    rootElement: 'ECF',
    version: '1.0',
    ecfType: '46',
    title: 'Comprobante para Exportaciones Electrónico (46)',
    sourceSpec: 'DGII Formato e-CF v1.0 · Ley 32-23',
  },
  ECF_47: {
    kind: 'ECF_47',
    fileName: 'e-CF_47_v.1.0.xsd',
    rootElement: 'ECF',
    version: '1.0',
    ecfType: '47',
    title: 'Comprobante para Pagos al Exterior Electrónico (47)',
    sourceSpec: 'DGII Formato e-CF v1.0 · Ley 32-23',
  },
  RFCE: {
    kind: 'RFCE',
    fileName: 'RFCE_v.1.0.xsd',
    rootElement: 'RFCE',
    version: '1.0',
    title: 'Resumen Factura de Consumo Electrónica (< RD$250,000)',
    sourceSpec: 'DGII Formato RFCE v1.0 · Ley 32-23',
  },
  ACECF: {
    kind: 'ACECF',
    fileName: 'ACECF_v.1.0.xsd',
    rootElement: 'ACECF',
    version: '1.0',
    title: 'Aprobación Comercial de e-CF',
    sourceSpec: 'DGII Formato ACECF v1.0 · Ley 32-23',
  },
  ARECF: {
    kind: 'ARECF',
    fileName: 'ARECF_v.1.0.xsd',
    rootElement: 'ARECF',
    version: '1.0',
    title: 'Acuse de Recibo Técnico de e-CF',
    sourceSpec: 'DGII Formato ARECF v1.0 · Ley 32-23',
  },
  ANECF: {
    kind: 'ANECF',
    fileName: 'ANECF_v.1.0.xsd',
    rootElement: 'ANECF',
    version: '1.0',
    title: 'Anulación de Secuencias e-NCF',
    sourceSpec: 'DGII Formato ANECF v1.0 · Ley 32-23',
  },
};

const COMMON_SIMPLE_TYPES_XSD = `
  <xs:simpleType name="VersionType">
    <xs:restriction base="xs:string">
      <xs:pattern value="1\\.0"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="RncOCedulaType">
    <xs:restriction base="xs:string">
      <xs:pattern value="[0-9]{9}|[0-9]{11}"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="RncEmpresaType">
    <xs:restriction base="xs:string">
      <xs:pattern value="[0-9]{9}|[0-9]{11}"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="FechaDgiiType">
    <xs:restriction base="xs:string">
      <xs:pattern value="(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-[0-9]{4}"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="FechaHoraDgiiType">
    <xs:restriction base="xs:string">
      <xs:pattern value="(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-[0-9]{4} ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="Decimal18v2Type">
    <xs:restriction base="xs:decimal">
      <xs:totalDigits value="18"/>
      <xs:fractionDigits value="2"/>
      <xs:minInclusive value="0.00"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="DecimalPositive2Type">
    <xs:restriction base="xs:decimal">
      <xs:totalDigits value="18"/>
      <xs:fractionDigits value="2"/>
      <xs:minInclusive value="0.01"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="DecimalPositive4Type">
    <xs:restriction base="xs:decimal">
      <xs:totalDigits value="18"/>
      <xs:fractionDigits value="4"/>
      <xs:minInclusive value="0.0001"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="IndicadorMontoGravadoType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="0"/>
      <xs:enumeration value="1"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="TipoPagoType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="1"/>
      <xs:enumeration value="2"/>
      <xs:enumeration value="3"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="FormaPagoType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="1"/>
      <xs:enumeration value="2"/>
      <xs:enumeration value="3"/>
      <xs:enumeration value="4"/>
      <xs:enumeration value="5"/>
      <xs:enumeration value="6"/>
      <xs:enumeration value="7"/>
      <xs:enumeration value="8"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="IndicadorFacturacionType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="0"/>
      <xs:enumeration value="1"/>
      <xs:enumeration value="2"/>
      <xs:enumeration value="3"/>
      <xs:enumeration value="4"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="IndicadorBienoServicioType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="1"/>
      <xs:enumeration value="2"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="CodigoModificacionType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="1"/>
      <xs:enumeration value="2"/>
      <xs:enumeration value="3"/>
      <xs:enumeration value="4"/>
      <xs:enumeration value="5"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="NumeroLineaType">
    <xs:restriction base="xs:integer">
      <xs:minInclusive value="1"/>
      <xs:maxInclusive value="1000"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="NombreItemType">
    <xs:restriction base="xs:string">
      <xs:minLength value="1"/>
      <xs:maxLength value="80"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="RazonSocialType">
    <xs:restriction base="xs:string">
      <xs:minLength value="1"/>
      <xs:maxLength value="150"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="DireccionType">
    <xs:restriction base="xs:string">
      <xs:minLength value="1"/>
      <xs:maxLength value="200"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="CorreoType">
    <xs:restriction base="xs:string">
      <xs:maxLength value="80"/>
      <xs:pattern value="[^@\\s]+@[^@\\s]+\\.[^@\\s]+"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="MonedaIsoType">
    <xs:restriction base="xs:string">
      <xs:pattern value="[A-Z]{3}"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="TasaItbisType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="18"/>
      <xs:enumeration value="16"/>
      <xs:enumeration value="0"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="EncfAnyType">
    <xs:restriction base="xs:string">
      <xs:pattern value="E(31|32|33|34|41|43|44|45|46|47)[0-9]{10}"/>
    </xs:restriction>
  </xs:simpleType>
`;

interface EcfSchemaBehavior {
  requiresSequenceExpiry: boolean;
  requiresBuyerSection: boolean;
  requiresBuyerRnc: boolean;
  requiresReferenceInfo: boolean;
}

const ECF_XSD_BEHAVIORS: Record<EcfTypeCode, EcfSchemaBehavior> = {
  '31': { requiresSequenceExpiry: true, requiresBuyerSection: true, requiresBuyerRnc: true, requiresReferenceInfo: false },
  '32': { requiresSequenceExpiry: false, requiresBuyerSection: true, requiresBuyerRnc: false, requiresReferenceInfo: false },
  '33': { requiresSequenceExpiry: true, requiresBuyerSection: true, requiresBuyerRnc: false, requiresReferenceInfo: true },
  '34': { requiresSequenceExpiry: false, requiresBuyerSection: true, requiresBuyerRnc: false, requiresReferenceInfo: true },
  '41': { requiresSequenceExpiry: true, requiresBuyerSection: true, requiresBuyerRnc: false, requiresReferenceInfo: false },
  '43': { requiresSequenceExpiry: true, requiresBuyerSection: false, requiresBuyerRnc: false, requiresReferenceInfo: false },
  '44': { requiresSequenceExpiry: true, requiresBuyerSection: true, requiresBuyerRnc: true, requiresReferenceInfo: false },
  '45': { requiresSequenceExpiry: true, requiresBuyerSection: true, requiresBuyerRnc: true, requiresReferenceInfo: false },
  '46': { requiresSequenceExpiry: true, requiresBuyerSection: true, requiresBuyerRnc: false, requiresReferenceInfo: false },
  '47': { requiresSequenceExpiry: true, requiresBuyerSection: true, requiresBuyerRnc: false, requiresReferenceInfo: false },
};

function buildEcfXsdForType(ecfType: EcfTypeCode): string {
  const b = ECF_XSD_BEHAVIORS[ecfType];
  return `<?xml version="1.0" encoding="utf-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" elementFormDefault="qualified">
  <!-- Esquema Oficial DGII e-CF Tipo ${ecfType} v1.0 (Ley 32-23 República Dominicana) -->
  ${COMMON_SIMPLE_TYPES_XSD}

  <xs:simpleType name="TipoeCFType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="${ecfType}"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="EncfSpecificType">
    <xs:restriction base="xs:string">
      <xs:pattern value="E${ecfType}[0-9]{10}"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:element name="ECF">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Encabezado">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Version" type="VersionType"/>
              <xs:element name="IdDoc">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="TipoeCF" type="TipoeCFType"/>
                    <xs:element name="eNCF" type="EncfSpecificType"/>
                    <xs:element name="FechaVencimientoSecuencia" type="FechaDgiiType" minOccurs="${b.requiresSequenceExpiry ? '1' : '0'}"/>
                    <xs:element name="IndicadorMontoGravado" type="IndicadorMontoGravadoType" minOccurs="0"/>
                    <xs:element name="TipoPago" type="TipoPagoType"/>
                    <xs:element name="FechaLimitePago" type="FechaDgiiType" minOccurs="0"/>
                    <xs:element name="TablaFormasPago" minOccurs="0">
                      <xs:complexType>
                        <xs:sequence>
                          <xs:element name="FormaDePago" maxOccurs="7">
                            <xs:complexType>
                              <xs:sequence>
                                <xs:element name="FormaPago" type="FormaPagoType"/>
                                <xs:element name="MontoPago" type="DecimalPositive2Type"/>
                              </xs:sequence>
                            </xs:complexType>
                          </xs:element>
                        </xs:sequence>
                      </xs:complexType>
                    </xs:element>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
              <xs:element name="Emisor">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="RNCEmisor" type="RncEmpresaType"/>
                    <xs:element name="RazonSocialEmisor" type="RazonSocialType"/>
                    <xs:element name="NombreComercial" type="RazonSocialType" minOccurs="0"/>
                    <xs:element name="DireccionEmisor" type="DireccionType"/>
                    <xs:element name="FechaEmision" type="FechaDgiiType"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
              <xs:element name="Comprador" minOccurs="${b.requiresBuyerSection ? '1' : '0'}">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="RNCComprador" type="RncOCedulaType" minOccurs="${b.requiresBuyerRnc ? '1' : '0'}"/>
                    <xs:element name="IdentificadorExtranjero" type="xs:string" minOccurs="0"/>
                    <xs:element name="RazonSocialComprador" type="RazonSocialType"/>
                    <xs:element name="CorreoComprador" type="CorreoType" minOccurs="0"/>
                    <xs:element name="DireccionComprador" type="DireccionType" minOccurs="0"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
              <xs:element name="Totales">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="MontoGravadoTotal" type="Decimal18v2Type" minOccurs="0"/>
                    <xs:element name="MontoGravadoI1" type="Decimal18v2Type" minOccurs="0"/>
                    <xs:element name="MontoGravadoI2" type="Decimal18v2Type" minOccurs="0"/>
                    <xs:element name="MontoExento" type="Decimal18v2Type" minOccurs="0"/>
                    <xs:element name="ITBIS1" type="TasaItbisType" minOccurs="0"/>
                    <xs:element name="ITBIS2" type="TasaItbisType" minOccurs="0"/>
                    <xs:element name="TotalITBIS" type="Decimal18v2Type" minOccurs="0"/>
                    <xs:element name="MontoImpuestoAdicional" type="Decimal18v2Type" minOccurs="0"/>
                    <xs:element name="MontoTotal" type="DecimalPositive2Type"/>
                    <xs:element name="TipoMoneda" type="MonedaIsoType" minOccurs="0"/>
                    <xs:element name="TipoCambio" type="DecimalPositive4Type" minOccurs="0"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:element name="DetallesItems">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Item" maxOccurs="1000">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="NumeroLinea" type="NumeroLineaType"/>
                    <xs:element name="IndicadorFacturacion" type="IndicadorFacturacionType"/>
                    <xs:element name="NombreItem" type="NombreItemType"/>
                    <xs:element name="IndicadorBienoServicio" type="IndicadorBienoServicioType"/>
                    <xs:element name="CantidadItem" type="DecimalPositive4Type"/>
                    <xs:element name="UnidadMedida" type="xs:string" minOccurs="0"/>
                    <xs:element name="PrecioUnitarioItem" type="Decimal18v2Type"/>
                    <xs:element name="DescuentoMonto" type="Decimal18v2Type" minOccurs="0"/>
                    <xs:element name="MontoItem" type="Decimal18v2Type"/>
                    <xs:element name="MontoITBIS" type="Decimal18v2Type" minOccurs="0"/>
                    <xs:element name="MontoOtrosImpuestos" type="Decimal18v2Type" minOccurs="0"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:element name="DescuentosORecargos" minOccurs="0">
          <xs:complexType>
            <xs:sequence>
              <xs:any minOccurs="0" maxOccurs="unbounded" processContents="lax"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:element name="InformacionReferencia" minOccurs="${b.requiresReferenceInfo ? '1' : '0'}">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="NCFModificado" type="EncfAnyType"/>
              <xs:element name="FechaNCFModificado" type="FechaDgiiType" minOccurs="0"/>
              <xs:element name="CodigoModificacion" type="CodigoModificacionType" minOccurs="0"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:any minOccurs="0" processContents="skip"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
`;
}

const RFCE_XSD = `<?xml version="1.0" encoding="utf-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" elementFormDefault="qualified">
  <!-- Esquema Oficial DGII RFCE v1.0 (Resumen Factura de Consumo < RD$250,000) -->
  ${COMMON_SIMPLE_TYPES_XSD}
  <xs:simpleType name="TipoeCF32Type">
    <xs:restriction base="xs:string">
      <xs:enumeration value="32"/>
    </xs:restriction>
  </xs:simpleType>
  <xs:simpleType name="Encf32Type">
    <xs:restriction base="xs:string">
      <xs:pattern value="E32[0-9]{10}"/>
    </xs:restriction>
  </xs:simpleType>
  <xs:element name="RFCE">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Encabezado">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Version" type="VersionType"/>
              <xs:element name="IdDoc">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="TipoeCF" type="TipoeCF32Type"/>
                    <xs:element name="eNCF" type="Encf32Type"/>
                    <xs:element name="TipoPago" type="TipoPagoType"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
              <xs:element name="Emisor">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="RNCEmisor" type="RncEmpresaType"/>
                    <xs:element name="RazonSocialEmisor" type="RazonSocialType"/>
                    <xs:element name="FechaEmision" type="FechaDgiiType"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
              <xs:element name="Comprador">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="RazonSocialComprador" type="RazonSocialType"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
              <xs:element name="Totales">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="MontoGravadoTotal" type="Decimal18v2Type" minOccurs="0"/>
                    <xs:element name="MontoExento" type="Decimal18v2Type" minOccurs="0"/>
                    <xs:element name="TotalITBIS" type="Decimal18v2Type" minOccurs="0"/>
                    <xs:element name="MontoTotal" type="DecimalPositive2Type"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
              <xs:element name="CodigoSeguridadeCF" type="xs:string"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:any minOccurs="0" processContents="skip"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
`;

const ACECF_XSD = `<?xml version="1.0" encoding="utf-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" elementFormDefault="qualified">
  <!-- Esquema Oficial DGII ACECF v1.0 (Aprobación Comercial) -->
  ${COMMON_SIMPLE_TYPES_XSD}
  <xs:simpleType name="EstadoAcecfType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="1"/>
      <xs:enumeration value="2"/>
    </xs:restriction>
  </xs:simpleType>
  <xs:element name="ACECF">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="DetalleAprobacionComercial">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Version" type="VersionType"/>
              <xs:element name="RNCEmisor" type="RncEmpresaType"/>
              <xs:element name="eNCF" type="EncfAnyType"/>
              <xs:element name="FechaEmision" type="FechaDgiiType"/>
              <xs:element name="MontoTotal" type="DecimalPositive2Type"/>
              <xs:element name="RNCComprador" type="RncOCedulaType"/>
              <xs:element name="Estado" type="EstadoAcecfType"/>
              <xs:element name="DetalleMotivoRechazo" type="xs:string" minOccurs="0"/>
              <xs:element name="FechaHoraAprobacionComercial" type="FechaHoraDgiiType"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:any minOccurs="0" processContents="skip"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
`;

const ARECF_XSD = `<?xml version="1.0" encoding="utf-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" elementFormDefault="qualified">
  <!-- Esquema Oficial DGII ARECF v1.0 (Acuse de Recibo Técnico) -->
  ${COMMON_SIMPLE_TYPES_XSD}
  <xs:simpleType name="EstadoArecfType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="0"/>
      <xs:enumeration value="1"/>
    </xs:restriction>
  </xs:simpleType>
  <xs:element name="ARECF">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="DetalleAcusedeRecibo">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Version" type="VersionType"/>
              <xs:element name="RNCEmisor" type="RncEmpresaType"/>
              <xs:element name="RNCComprador" type="RncOCedulaType"/>
              <xs:element name="eNCF" type="EncfAnyType"/>
              <xs:element name="Estado" type="EstadoArecfType"/>
              <xs:element name="CodigoMotivoNoRecibido" type="xs:string" minOccurs="0"/>
              <xs:element name="FechaHoraAcuseRecibo" type="FechaHoraDgiiType"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:any minOccurs="0" processContents="skip"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
`;

const ANECF_XSD = `<?xml version="1.0" encoding="utf-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" elementFormDefault="qualified">
  <!-- Esquema Oficial DGII ANECF v1.0 (Anulación de Secuencias e-NCF) -->
  ${COMMON_SIMPLE_TYPES_XSD}
  <xs:simpleType name="TipoeCFAllType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="31"/>
      <xs:enumeration value="32"/>
      <xs:enumeration value="33"/>
      <xs:enumeration value="34"/>
      <xs:enumeration value="41"/>
      <xs:enumeration value="43"/>
      <xs:enumeration value="44"/>
      <xs:enumeration value="45"/>
      <xs:enumeration value="46"/>
      <xs:enumeration value="47"/>
    </xs:restriction>
  </xs:simpleType>
  <xs:element name="ANECF">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Encabezado">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Version" type="VersionType"/>
              <xs:element name="RncEmisor" type="RncEmpresaType"/>
              <xs:element name="CantidadeNCFAnulados" type="xs:integer"/>
              <xs:element name="FechaHoraAnulacioneNCF" type="FechaHoraDgiiType"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:element name="DetalleAnulacion">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Anulacion" maxOccurs="1000">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="NoLinea" type="NumeroLineaType"/>
                    <xs:element name="TipoeCF" type="TipoeCFAllType"/>
                    <xs:element name="TablaRangoSecuenciasAnuladaseNCF">
                      <xs:complexType>
                        <xs:sequence>
                          <xs:element name="Secuencias" maxOccurs="1000">
                            <xs:complexType>
                              <xs:sequence>
                                <xs:element name="SecuenciaeNCFDesde" type="EncfAnyType"/>
                                <xs:element name="SecuenciaeNCFHasta" type="EncfAnyType"/>
                              </xs:sequence>
                            </xs:complexType>
                          </xs:element>
                        </xs:sequence>
                      </xs:complexType>
                    </xs:element>
                    <xs:element name="CantidadeNCFAnulados" type="xs:integer"/>
                  </xs:sequence>
                </xs:complexType>
              </xs:element>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:any minOccurs="0" processContents="skip"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
`;

export const BUILTIN_DGII_XSD_SCHEMAS: Record<DgiiSchemaDocumentKind, string> = {
  ECF_31: buildEcfXsdForType('31'),
  ECF_32: buildEcfXsdForType('32'),
  ECF_33: buildEcfXsdForType('33'),
  ECF_34: buildEcfXsdForType('34'),
  ECF_41: buildEcfXsdForType('41'),
  ECF_43: buildEcfXsdForType('43'),
  ECF_44: buildEcfXsdForType('44'),
  ECF_45: buildEcfXsdForType('45'),
  ECF_46: buildEcfXsdForType('46'),
  ECF_47: buildEcfXsdForType('47'),
  RFCE: RFCE_XSD,
  ACECF: ACECF_XSD,
  ARECF: ARECF_XSD,
  ANECF: ANECF_XSD,
};

export function ecfTypeToSchemaKind(ecfType: EcfTypeCode): DgiiSchemaDocumentKind {
  return `ECF_${ecfType}` as DgiiSchemaDocumentKind;
}
