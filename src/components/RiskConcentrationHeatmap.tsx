import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ArrowUpRight, MapPin, X } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  buildRiskHeatmapMatrix,
  type GeoGranularity,
  type HeatmapMetricMode,
  type ProfileDimension,
  type RiskHeatmapCell,
} from '../engine/riskHeatmap';
import { APPLICATION_STATUS_LABELS, formatMoney } from '../utils/formatters';
import type {
  ApplicationRecord,
  CreditPolicyRecord,
  CustomerRecord,
  LoanRecord,
} from '../types/axycore';

interface RiskConcentrationHeatmapProps {
  applications: ApplicationRecord[];
  customers: CustomerRecord[];
  loans: LoanRecord[];
  policy?: CreditPolicyRecord | null;
}

interface HoveredTooltipState {
  cell: RiskHeatmapCell;
  x: number;
  y: number;
}

const METRIC_LABELS: Record<HeatmapMetricMode, string> = {
  RISK_INDEX: 'Índice de Riesgo',
  HIGH_RISK_PCT: '% Riesgo Alto/Crítico',
  EXPOSURE_SHARE: 'Concentración Cartera %',
};

const PROFILE_LABELS: Record<ProfileDimension, string> = {
  INCOME_SEGMENT: 'Segmento e Ingreso',
  HOUSING_TENURE: 'Tenencia Vivienda',
  PRODUCT: 'Producto Crediticio',
};

function formatMetricBadge(value: number, mode: HeatmapMetricMode): string {
  if (mode === 'RISK_INDEX') return `${Math.round(value)} pts`;
  return `${value.toFixed(1)}%`;
}

export function RiskConcentrationHeatmap({
  applications,
  customers,
  loans,
  policy,
}: RiskConcentrationHeatmapProps) {
  const { darkMode, rbac, setSelectedApplicationId, setActiveSection } = useAxyCore();

  const [geoGranularity, setGeoGranularity] = useState<GeoGranularity>('PROVINCE');
  const [profileDimension, setProfileDimension] = useState<ProfileDimension>('INCOME_SEGMENT');
  const [metricMode, setMetricMode] = useState<HeatmapMetricMode>('RISK_INDEX');

  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null);
  const [hoveredTooltip, setHoveredTooltip] = useState<HoveredTooltipState | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(840);

  const matrix = useMemo(
    () =>
      buildRiskHeatmapMatrix({
        applications,
        customers,
        loans,
        policy,
        geoGranularity,
        profileDimension,
        metricMode,
      }),
    [applications, customers, loans, policy, geoGranularity, profileDimension, metricMode]
  );

  const selectedCell = useMemo(() => {
    if (!selectedCellKey) return null;
    return (
      matrix.cells.find((c) => `${c.zone}:::${c.profile}` === selectedCellKey && c.count > 0) ??
      null
    );
  }, [matrix.cells, selectedCellKey]);

  // Clear selection when dimension or filters leave cell empty
  useEffect(() => {
    if (selectedCellKey && !selectedCell) {
      setSelectedCellKey(null);
    }
  }, [selectedCellKey, selectedCell]);

  // Responsive SVG width tracking
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateWidth = () => {
      const next = Math.max(360, Math.floor(el.clientWidth));
      setContainerWidth(next);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // D3 Heatmap Rendering
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    if (matrix.zones.length === 0 || matrix.profiles.length === 0) {
      return;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const transitionMs = prefersReducedMotion ? 0 : 220;

    const margin = {
      top: 52,
      right: 24,
      bottom: 58,
      left: containerWidth < 640 ? 128 : 168,
    };

    const rowHeight = 56;
    const minInnerWidth = Math.max(360, matrix.profiles.length * 124);
    const totalWidth = Math.max(containerWidth, minInnerWidth + margin.left + margin.right);
    const innerWidth = totalWidth - margin.left - margin.right;
    const innerHeight = Math.max(112, matrix.zones.length * rowHeight);
    const totalHeight = innerHeight + margin.top + margin.bottom;

    svg
      .attr('width', totalWidth)
      .attr('height', totalHeight)
      .attr('viewBox', `0 0 ${totalWidth} ${totalHeight}`)
      .attr('role', 'img')
      .attr(
        'aria-label',
        `Mapa de calor de concentración de riesgos por ${
          geoGranularity === 'PROVINCE' ? 'provincia' : 'municipio'
        } y ${PROFILE_LABELS[profileDimension]}`
      );

    const domainMax =
      metricMode === 'EXPOSURE_SHARE'
        ? Math.max(25, Math.ceil(matrix.maxMetricValue / 10) * 10)
        : 100;

    // Calibrated perceptual risk ramp from emerald-cool (low) -> amber (moderate) -> crimson (high)
    const colorInterpolator = darkMode
      ? d3.piecewise(d3.interpolateLab, ['#0f3b2e', '#78350f', '#c2410c', '#b91c1c'])
      : d3.piecewise(d3.interpolateLab, ['#dcfce7', '#fef08a', '#f59e0b', '#dc2626']);

    const colorScale = d3.scaleSequential(colorInterpolator).domain([0, domainMax]).clamp(true);

    const xScale = d3
      .scaleBand<string>()
      .domain(matrix.profiles)
      .range([0, innerWidth])
      .padding(0.08);

    const yScale = d3
      .scaleBand<string>()
      .domain(matrix.zones)
      .range([0, innerHeight])
      .padding(0.1);

    const emptyFill = darkMode ? '#1e293b' : '#f8fafc';
    const emptyStroke = darkMode ? '#334155' : '#e2e8f0';
    const axisTextColor = darkMode ? '#cbd5e1' : '#334155';
    const mutedTextColor = darkMode ? '#64748b' : '#94a3b8';

    // Gradient definition for legend
    const defs = svg.append('defs');
    const gradId = `axyHeatmapGrad_${darkMode ? 'dark' : 'light'}`;
    const linearGrad = defs
      .append('linearGradient')
      .attr('id', gradId)
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '100%')
      .attr('y2', '0%');

    const stops = [0, 0.25, 0.5, 0.75, 1];
    stops.forEach((t) => {
      linearGrad
        .append('stop')
        .attr('offset', `${t * 100}%`)
        .attr('stop-color', colorScale(t * domainMax));
    });

    const chartGroup = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Top X Axis (Customer Profiles)
    const xAxisGroup = chartGroup
      .append('g')
      .call(d3.axisTop(xScale).tickSize(0).tickPadding(10));
    xAxisGroup.select('.domain').remove();
    xAxisGroup
      .selectAll('text')
      .style('fill', axisTextColor)
      .style('font-size', '11px')
      .style('font-weight', '600')
      .style('font-family', '"DM Sans", system-ui, sans-serif')
      .each(function () {
        const self = d3.select(this);
        const text = String(self.text() || '');
        const maxLen = xScale.bandwidth() < 140 ? 18 : 24;
        if (text.length > maxLen) {
          self.text(`${text.slice(0, maxLen - 1)}…`);
        }
      });

    // Left Y Axis (Geographic Zones)
    const yAxisGroup = chartGroup
      .append('g')
      .call(d3.axisLeft(yScale).tickSize(0).tickPadding(10));
    yAxisGroup.select('.domain').remove();
    yAxisGroup
      .selectAll('text')
      .style('fill', axisTextColor)
      .style('font-size', '11px')
      .style('font-weight', '600')
      .style('font-family', '"DM Sans", system-ui, sans-serif')
      .each(function () {
        const self = d3.select(this);
        const text = String(self.text() || '');
        const maxLen = containerWidth < 640 ? 15 : 22;
        if (text.length > maxLen) {
          self.text(`${text.slice(0, maxLen - 1)}…`);
        }
      });

    // Heatmap Tiles
    const cellGroups = chartGroup
      .selectAll<SVGGElement, RiskHeatmapCell>('g.heatmap-cell')
      .data(matrix.cells, (d: any) => (d ? `${d.zone}:::${d.profile}` : ''))
      .enter()
      .append('g')
      .attr('class', 'heatmap-cell')
      .attr(
        'transform',
        (d) => `translate(${xScale(d.profile) ?? 0},${yScale(d.zone) ?? 0})`
      );

    const rects = cellGroups
      .append('rect')
      .attr('width', xScale.bandwidth())
      .attr('height', yScale.bandwidth())
      .attr('rx', 8)
      .attr('ry', 8)
      .attr('fill', emptyFill)
      .attr('stroke', (d) => {
        const key = `${d.zone}:::${d.profile}`;
        if (key === selectedCellKey) return darkMode ? '#38bdf8' : '#0369a1';
        return d.count > 0 ? (darkMode ? '#1e293b' : '#ffffff') : emptyStroke;
      })
      .attr('stroke-width', (d) =>
        `${d.zone}:::${d.profile}` === selectedCellKey ? 2.5 : 1
      )
      .style('cursor', (d) => (d.count > 0 ? 'pointer' : 'default'))
      .attr('tabindex', (d) => (d.count > 0 ? 0 : -1))
      .attr('role', (d) => (d.count > 0 ? 'button' : 'presentation'))
      .attr('aria-label', (d) =>
        d.count > 0
          ? `${d.zone}, ${d.profile}: ${formatMetricBadge(d.metricValue, metricMode)}, ${
              d.count
            } operaciones`
          : `${d.zone}, ${d.profile}: sin operaciones`
      );

    rects
      .transition()
      .duration(transitionMs)
      .attr('fill', (d) => (d.count > 0 ? colorScale(d.metricValue) : emptyFill));

    // Primary Metric Label inside cell
    cellGroups
      .append('text')
      .attr('x', xScale.bandwidth() / 2)
      .attr('y', yScale.bandwidth() / 2 - 4)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .style('pointer-events', 'none')
      .style('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .style('font-variant-numeric', 'tabular-nums')
      .style('font-size', '12px')
      .style('font-weight', '700')
      .style('fill', (d) => {
        if (d.count === 0) return mutedTextColor;
        const lum = d3.lab(colorScale(d.metricValue)).l;
        return lum < 58 ? '#f8fafc' : '#0f172a';
      })
      .text((d) => (d.count > 0 ? formatMetricBadge(d.metricValue, metricMode) : '—'));

    // Secondary Count Label inside cell
    cellGroups
      .append('text')
      .attr('x', xScale.bandwidth() / 2)
      .attr('y', yScale.bandwidth() / 2 + 12)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .style('pointer-events', 'none')
      .style('font-family', '"DM Sans", system-ui, sans-serif')
      .style('font-variant-numeric', 'tabular-nums')
      .style('font-size', '10px')
      .style('font-weight', '500')
      .style('opacity', (d) => (d.count > 0 ? 0.88 : 0.6))
      .style('fill', (d) => {
        if (d.count === 0) return mutedTextColor;
        const lum = d3.lab(colorScale(d.metricValue)).l;
        return lum < 58 ? '#e2e8f0' : '#334155';
      })
      .text((d) =>
        d.count > 0 ? `${d.count} ${d.count === 1 ? 'op' : 'ops'}` : ''
      );

    // Interactions (Hover + Click + Keyboard)
    cellGroups
      .on('mouseenter', function (event: MouseEvent, d: RiskHeatmapCell) {
        if (!d || d.count === 0) return;
        d3.select(this)
          .select('rect')
          .attr('stroke', darkMode ? '#38bdf8' : '#0284c7')
          .attr('stroke-width', 2);

        const wrapBounds = wrapperRef.current?.getBoundingClientRect();
        if (wrapBounds) {
          const relX = event.clientX - wrapBounds.left;
          const relY = event.clientY - wrapBounds.top;
          setHoveredTooltip({ cell: d, x: relX, y: relY });
        }
      })
      .on('mousemove', function (event: MouseEvent, d: RiskHeatmapCell) {
        if (!d || d.count === 0) return;
        const wrapBounds = wrapperRef.current?.getBoundingClientRect();
        if (wrapBounds) {
          const relX = event.clientX - wrapBounds.left;
          const relY = event.clientY - wrapBounds.top;
          setHoveredTooltip({ cell: d, x: relX, y: relY });
        }
      })
      .on('mouseleave', function (_event: MouseEvent, d: RiskHeatmapCell) {
        if (!d) {
          setHoveredTooltip(null);
          return;
        }
        const key = `${d.zone}:::${d.profile}`;
        const isSelected = key === selectedCellKey;
        d3.select(this)
          .select('rect')
          .attr(
            'stroke',
            isSelected
              ? darkMode
                ? '#38bdf8'
                : '#0369a1'
              : d.count > 0
              ? darkMode
                ? '#1e293b'
                : '#ffffff'
              : emptyStroke
          )
          .attr('stroke-width', isSelected ? 2.5 : 1);
        setHoveredTooltip(null);
      })
      .on('click', (_event: MouseEvent, d: RiskHeatmapCell) => {
        if (!d || d.count === 0) return;
        const key = `${d.zone}:::${d.profile}`;
        setSelectedCellKey((prev) => (prev === key ? null : key));
      })
      .on('keydown', (event: KeyboardEvent, d: RiskHeatmapCell) => {
        if (!d || d.count === 0) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const key = `${d.zone}:::${d.profile}`;
          setSelectedCellKey((prev) => (prev === key ? null : key));
        }
      });

    // D3 Legend Scale Bar
    const legendWidth = Math.min(260, Math.max(160, innerWidth * 0.45));
    const legendHeight = 10;
    const legendX = innerWidth - legendWidth;
    const legendY = innerHeight + 22;

    const legendGroup = chartGroup
      .append('g')
      .attr('transform', `translate(${legendX},${legendY})`);

    legendGroup
      .append('text')
      .attr('x', -12)
      .attr('y', legendHeight / 2 + 1)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .style('font-size', '10px')
      .style('font-weight', '600')
      .style('fill', axisTextColor)
      .text(METRIC_LABELS[metricMode]);

    legendGroup
      .append('rect')
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .attr('rx', 4)
      .attr('fill', `url(#${gradId})`);

    const legendScale = d3.scaleLinear().domain([0, domainMax]).range([0, legendWidth]);
    const legendAxis = d3
      .axisBottom(legendScale)
      .ticks(4)
      .tickSize(4)
      .tickFormat((val) =>
        metricMode === 'RISK_INDEX' ? `${Number(val)}` : `${Number(val)}%`
      );

    const legendAxisGroup = legendGroup
      .append('g')
      .attr('transform', `translate(0,${legendHeight})`)
      .call(legendAxis);
    legendAxisGroup.select('.domain').remove();
    legendAxisGroup
      .selectAll('text')
      .style('font-size', '10px')
      .style('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .style('fill', mutedTextColor);
    legendAxisGroup.selectAll('line').style('stroke', mutedTextColor);
  }, [
    matrix,
    containerWidth,
    darkMode,
    geoGranularity,
    profileDimension,
    metricMode,
    selectedCellKey,
  ]);

  const handleOpenApplication = (app: ApplicationRecord) => {
    setSelectedApplicationId(app.id);
    const inEvalStage = ['RECIBIDA', 'EN_EVALUACION', 'DEVUELTA'].includes(app.status);
    if (inEvalStage && rbac.canAccessSection('evaluation')) {
      setActiveSection('evaluation');
    } else if (rbac.canAccessSection('applications')) {
      setActiveSection('applications');
    }
  };

  if (applications.length === 0) {
    return null;
  }

  return (
    <section
      className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5"
      aria-label="Mapa de calor de concentración de riesgos"
    >
      {/* Header & Controls */}
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
        <div className="space-y-1">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <MapPin className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" />
            <span>Mapa de Calor de Concentración de Riesgos (Zona × Perfil de Cliente)</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            <span>{matrix.totalCount} operaciones evaluadas</span>
            <span aria-hidden="true"> · </span>
            <span>
              Riesgo Medio-Alto/Alto/Crítico: {matrix.totalHighRiskCount} ({matrix.overallHighRiskPct.toFixed(1)}%)
            </span>
            <span aria-hidden="true"> · </span>
            <span>Exposición total eq.: {formatMoney(matrix.totalExposureDop, 'DOP')}</span>
            {matrix.topConcentrationCell && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Mayor foco: {matrix.topConcentrationCell.zone} / {matrix.topConcentrationCell.profile} (
                  {formatMetricBadge(matrix.topConcentrationCell.metricValue, metricMode)})
                </span>
              </>
            )}
          </p>
        </div>

        {/* Interactive Axis & Metric Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div
            className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800"
            role="group"
            aria-label="Granularidad geográfica"
          >
            <button
              type="button"
              onClick={() => setGeoGranularity('PROVINCE')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                geoGranularity === 'PROVINCE'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Provincia
            </button>
            <button
              type="button"
              onClick={() => setGeoGranularity('MUNICIPALITY')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                geoGranularity === 'MUNICIPALITY'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Municipio
            </button>
          </div>

          <div
            className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800"
            role="group"
            aria-label="Dimensión de perfil"
          >
            <button
              type="button"
              onClick={() => setProfileDimension('INCOME_SEGMENT')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                profileDimension === 'INCOME_SEGMENT'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Segmento
            </button>
            <button
              type="button"
              onClick={() => setProfileDimension('HOUSING_TENURE')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                profileDimension === 'HOUSING_TENURE'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Vivienda
            </button>
            <button
              type="button"
              onClick={() => setProfileDimension('PRODUCT')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                profileDimension === 'PRODUCT'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Producto
            </button>
          </div>

          <div
            className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800"
            role="group"
            aria-label="Métrica de intensidad"
          >
            <button
              type="button"
              onClick={() => setMetricMode('RISK_INDEX')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                metricMode === 'RISK_INDEX'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Índice Riesgo
            </button>
            <button
              type="button"
              onClick={() => setMetricMode('HIGH_RISK_PCT')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                metricMode === 'HIGH_RISK_PCT'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              % Alto Riesgo
            </button>
            <button
              type="button"
              onClick={() => setMetricMode('EXPOSURE_SHARE')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                metricMode === 'EXPOSURE_SHARE'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Exposición %
            </button>
          </div>
        </div>
      </div>

      {/* D3 Heatmap Viewport */}
      <div ref={wrapperRef} className="relative w-full overflow-x-auto">
        {matrix.zones.length === 0 ? (
          <div className="py-12 px-4 text-center rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-dashed border-slate-200 dark:border-white/10 text-xs text-slate-500">
            No se han registrado operaciones con ubicación geográfica clasificada en este filtro.
          </div>
        ) : (
          <svg ref={svgRef} className="block" />
        )}

        {/* Dynamic D3 Hover Tooltip */}
        {hoveredTooltip && (
          <div
            className="pointer-events-none absolute z-20 w-64 p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-md text-xs space-y-1.5"
            style={{
              left: Math.min(Math.max(8, hoveredTooltip.x + 14), Math.max(8, containerWidth - 270)),
              top: Math.max(8, hoveredTooltip.y - 10),
            }}
          >
            <p className="font-semibold text-slate-900 dark:text-white truncate">
              {hoveredTooltip.cell.zone} · {hoveredTooltip.cell.profile}
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums">
              <span className="font-sans text-slate-500 dark:text-slate-400">Índice Riesgo:</span>
              <span className="text-right font-semibold text-slate-900 dark:text-white">
                {hoveredTooltip.cell.riskIndex} / 100
              </span>

              <span className="font-sans text-slate-500 dark:text-slate-400">Score V2 Prom.:</span>
              <span className="text-right text-slate-800 dark:text-slate-200">
                {hoveredTooltip.cell.avgScore !== null
                  ? `${hoveredTooltip.cell.avgScore.toFixed(1)} pts`
                  : 'N/D'}
              </span>

              <span className="font-sans text-slate-500 dark:text-slate-400">Riesgo Alto/Crít.:</span>
              <span className="text-right text-rose-700 dark:text-rose-400">
                {hoveredTooltip.cell.highRiskCount}/{hoveredTooltip.cell.count} (
                {hoveredTooltip.cell.highRiskPct.toFixed(1)}%)
              </span>

              <span className="font-sans text-slate-500 dark:text-slate-400">Exposición eq.:</span>
              <span className="text-right text-slate-800 dark:text-slate-200">
                {formatMoney(hoveredTooltip.cell.exposureDop, 'DOP')}
              </span>

              <span className="font-sans text-slate-500 dark:text-slate-400">Banda Dominante:</span>
              <span className="font-sans text-right text-slate-800 dark:text-slate-200">
                {hoveredTooltip.cell.dominantBand}
              </span>
            </div>
            <p className="text-[10px] text-sky-700 dark:text-sky-400 pt-0.5">
              Clic para inspeccionar expedientes en esta intersección
            </p>
          </div>
        )}
      </div>

      {/* Selected Cell Drilldown Table (Hairline Separated, Zero Nested Cards) */}
      {selectedCell && (
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-white">
                Detalle de Concentración: {selectedCell.zone} · {selectedCell.profile}
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {selectedCell.count} solicitudes · Índice de riesgo {selectedCell.riskIndex}/100 ·
                Exposición eq. {formatMoney(selectedCell.exposureDop, 'DOP')} ({selectedCell.exposureSharePct.toFixed(1)}%)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedCellKey(null)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cerrar detalle</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 font-medium">Solicitud</th>
                  <th className="py-2 px-3 font-medium">Solicitante</th>
                  <th className="py-2 px-3 font-medium">Municipio / Zona</th>
                  <th className="py-2 px-3 font-medium">Banda V2</th>
                  <th className="py-2 px-3 font-medium text-right">Score</th>
                  <th className="py-2 px-3 font-medium text-right">Exposición</th>
                  <th className="py-2 px-3 font-medium">Estado</th>
                  <th className="py-2 pl-3 font-medium text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {selectedCell.items.map((item) => (
                  <tr
                    key={item.application.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                      {item.application.applicationNumber}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 dark:text-slate-200 max-w-[180px] truncate">
                      {item.application.applicantDisplayName}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {item.customer?.municipality || item.customer?.province || '—'}
                    </td>
                    <td
                      className={`py-2.5 px-3 font-medium whitespace-nowrap ${
                        item.isHighRisk
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {item.riskBand}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-900 dark:text-white">
                      {item.score !== null ? `${item.score}/100` : '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      {formatMoney(
                        item.application.recommendedAmount ?? item.application.requestedAmount,
                        item.application.currency
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {APPLICATION_STATUS_LABELS[item.application.status]}
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenApplication(item.application)}
                        className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-400 hover:underline font-medium cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <span>Abrir</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
