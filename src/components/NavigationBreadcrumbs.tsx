import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Home } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  buildBreadcrumbsForSection,
  type BreadcrumbSegment,
} from '../engine/navigationBreadcrumbs';
import type { NavSectionId } from '../types/axycore';

interface NavigationBreadcrumbsProps {
  /** 'header' fits the top bar; 'inline' fits view headers inside Administration/Audit */
  variant?: 'header' | 'inline';
  /** Enables a quick-jump dropdown on segments that have permitted sibling submenus */
  showSiblingSwitcher?: boolean;
  /** Optional organization label prefix in header variant */
  organizationLabel?: string;
}

export function NavigationBreadcrumbs({
  variant = 'inline',
  showSiblingSwitcher = true,
  organizationLabel,
}: NavigationBreadcrumbsProps) {
  const { activeSection, setActiveSection, rbac } = useAxyCore();
  const [openMenuSegmentId, setOpenMenuSegmentId] = useState<string | null>(null);
  const containerRef = useRef<HTMLElement>(null);

  const segments = useMemo(
    () =>
      buildBreadcrumbsForSection({
        activeSection,
        canAccessSection: rbac.canAccessSection,
      }),
    [activeSection, rbac]
  );

  // Close dropdown automatically whenever activeSection changes
  useEffect(() => {
    setOpenMenuSegmentId(null);
  }, [activeSection]);

  // Dismiss dropdown on outside click or Escape key
  useEffect(() => {
    if (!openMenuSegmentId) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenuSegmentId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuSegmentId(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuSegmentId]);

  const handleNavigate = (sectionId?: NavSectionId) => {
    if (!sectionId) return;
    setOpenMenuSegmentId(null);
    setActiveSection(sectionId);
  };

  const renderSegmentContent = (segment: BreadcrumbSegment) => {
    const hasDropdown =
      showSiblingSwitcher &&
      Array.isArray(segment.siblings) &&
      segment.siblings.length > 1;
    const isMenuOpen = openMenuSegmentId === segment.id;

    if (segment.isCurrent) {
      return (
        <div className="relative inline-flex items-center gap-1 min-w-0">
          {variant === 'header' ? (
            <h1
              aria-current="page"
              className="font-display font-bold text-slate-950 dark:text-white truncate text-sm"
            >
              {segment.label}
            </h1>
          ) : (
            <span
              aria-current="page"
              className="font-semibold text-slate-900 dark:text-white truncate"
            >
              {segment.label}
            </span>
          )}

          {hasDropdown && (
            <button
              type="button"
              onClick={() =>
                setOpenMenuSegmentId((prev) => (prev === segment.id ? null : segment.id))
              }
              aria-expanded={isMenuOpen}
              aria-haspopup="menu"
              aria-label={`Cambiar submenú desde ${segment.label}`}
              className="p-0.5 rounded text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>
          )}

          {hasDropdown && isMenuOpen && (
            <div
              role="menu"
              className="absolute left-0 top-full mt-1.5 min-w-[220px] py-1 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/25 shadow-xl z-50 text-xs"
            >
              {segment.siblings!.map((sib) => {
                const isActiveSibling = sib.sectionId === activeSection;
                return (
                  <button
                    key={sib.sectionId}
                    type="button"
                    role="menuitem"
                    onClick={() => handleNavigate(sib.sectionId)}
                    className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 whitespace-nowrap cursor-pointer transition-colors ${
                      isActiveSibling
                        ? 'bg-sky-50 dark:bg-[#0066FF]/20 text-sky-800 dark:text-[#00D1FF] font-semibold'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="truncate">{sib.label}</span>
                    {isActiveSibling && (
                      <span className="text-[10px] font-mono text-sky-600 dark:text-[#00D1FF] shrink-0">
                        Actual
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="relative inline-flex items-center gap-0.5 shrink-0">
        {segment.targetSection ? (
          <button
            type="button"
            onClick={() => handleNavigate(segment.targetSection)}
            className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-sky-700 dark:hover:text-[#00D1FF] hover:underline underline-offset-2 transition-colors whitespace-nowrap cursor-pointer"
          >
            {segment.isHome && <Home className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
            <span>{segment.label}</span>
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {segment.isHome && <Home className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
            <span>{segment.label}</span>
          </span>
        )}

        {hasDropdown && (
          <button
            type="button"
            onClick={() =>
              setOpenMenuSegmentId((prev) => (prev === segment.id ? null : segment.id))
            }
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            aria-label={`Ver submenús de ${segment.label}`}
            className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <ChevronDown
              className={`w-3 h-3 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>
        )}

        {hasDropdown && isMenuOpen && (
          <div
            role="menu"
            className="absolute left-0 top-full mt-1.5 min-w-[220px] py-1 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/25 shadow-xl z-50 text-xs"
          >
            {segment.siblings!.map((sib) => {
              const isActiveSibling = sib.sectionId === activeSection;
              return (
                <button
                  key={sib.sectionId}
                  type="button"
                  role="menuitem"
                  onClick={() => handleNavigate(sib.sectionId)}
                  className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 whitespace-nowrap cursor-pointer transition-colors ${
                    isActiveSibling
                      ? 'bg-sky-50 dark:bg-[#0066FF]/20 text-sky-800 dark:text-[#00D1FF] font-semibold'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="truncate">{sib.label}</span>
                  {isActiveSibling && (
                    <span className="text-[10px] font-mono text-sky-600 dark:text-[#00D1FF] shrink-0">
                      Actual
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav
      ref={containerRef}
      aria-label="Ruta de navegación"
      className={variant === 'header' ? 'min-w-0 flex items-center' : 'min-w-0'}
    >
      <ol
        className={`flex items-center flex-wrap gap-1.5 ${
          variant === 'header' ? 'text-xs sm:text-sm' : 'text-xs'
        }`}
      >
        {variant === 'header' && organizationLabel && (
          <li className="hidden xl:inline-flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-[#041B4E] dark:text-[#00B8FF] truncate max-w-[190px]">
              {organizationLabel}
            </span>
            <ChevronRight
              className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0"
              aria-hidden="true"
            />
          </li>
        )}

        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          const hideIntermediateOnXs =
            variant === 'header' && !isLast && index < segments.length - 2;

          return (
            <li
              key={segment.id}
              className={`items-center gap-1.5 min-w-0 ${
                hideIntermediateOnXs ? 'hidden md:inline-flex' : 'inline-flex'
              }`}
            >
              {renderSegmentContent(segment)}
              {!isLast && (
                <ChevronRight
                  className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
