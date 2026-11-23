import React, { useEffect, useState } from 'react';
import { isValidInstitutionalLogoUrl } from '../utils/institutionalLogo';

interface InstitutionalLogoBadgeProps {
  logoUrl?: string | null;
  name: string;
  primaryColor?: string;
  accentColor?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<
  NonNullable<InstitutionalLogoBadgeProps['size']>,
  { box: string; imgPad: string; text: string }
> = {
  xs: { box: 'h-7 w-7 rounded-lg', imgPad: 'p-0.5', text: 'text-[10px]' },
  sm: { box: 'h-9 w-9 rounded-xl', imgPad: 'p-1', text: 'text-xs' },
  md: { box: 'h-11 w-11 rounded-xl', imgPad: 'p-1', text: 'text-sm' },
  lg: { box: 'h-14 w-14 rounded-2xl', imgPad: 'p-1.5', text: 'text-base' },
  xl: { box: 'h-16 w-16 rounded-2xl', imgPad: 'p-1.5', text: 'text-lg' },
};

function getInitials(name: string): string {
  const words = (name || 'IN')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'IN';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export const InstitutionalLogoBadge: React.FC<InstitutionalLogoBadgeProps> = ({
  logoUrl,
  name,
  primaryColor = '#0f3d91',
  accentColor = '#0284c7',
  size = 'sm',
  className = '',
}) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);

  const hasValidLogo = isValidInstitutionalLogoUrl(logoUrl) && !failed;
  const spec = SIZE_CLASSES[size];

  if (hasValidLogo) {
    return (
      <div
        className={`${spec.box} ${spec.imgPad} bg-white border border-slate-200/90 shadow-sm flex items-center justify-center shrink-0 overflow-hidden ${className}`}
      >
        <img
          src={logoUrl!.trim()}
          alt={`Logo de ${name}`}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="max-h-full max-w-full w-auto h-auto object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className={`${spec.box} ${spec.text} flex items-center justify-center text-white font-display font-bold shrink-0 border border-white/15 shadow-sm ${className}`}
      style={{
        background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`,
      }}
      aria-label={name}
    >
      {getInitials(name)}
    </div>
  );
};
