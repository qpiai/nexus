'use client';

import { cn } from '@/lib/utils';
import { ChevronDown, Check, Search } from 'lucide-react';
import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo, ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface NexusSelectOption {
  value: string;
  label: string;
  description?: string;
  badge?: ReactNode;
  icon?: ReactNode;
  /** Filterable tags (e.g., model type, family) */
  tags?: string[];
}

export interface FilterGroup {
  label: string;
  options: { value: string; label: string; color?: string }[];
}

interface NexusSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: NexusSelectOption[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  icon?: ReactNode;
  maxHeight?: number;
  size?: 'sm' | 'md';
  /** Enable search input in dropdown */
  searchable?: boolean;
  /** Filter chip groups (e.g., type, family) */
  filterGroups?: FilterGroup[];
}

export function NexusSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className,
  triggerClassName,
  disabled = false,
  icon,
  maxHeight = 240,
  size = 'md',
  searchable = false,
  filterGroups,
}: NexusSelectProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [dropdownPos, setDropdownPos] = useState<{
    top: number | undefined;
    bottom: number | undefined;
    left: number;
    width: number;
    openUp: boolean;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find(o => o.value === value);

  // Filter options by search and active filters
  const filteredOptions = useMemo(() => {
    let filtered = options;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(o =>
        o.label.toLowerCase().includes(q) ||
        (o.description && o.description.toLowerCase().includes(q)) ||
        (o.tags && o.tags.some(t => t.toLowerCase().includes(q)))
      );
    }
    if (activeFilters.size > 0) {
      filtered = filtered.filter(o =>
        o.tags && o.tags.some(t => activeFilters.has(t))
      );
    }
    return filtered;
  }, [options, searchQuery, activeFilters]);

  const toggleFilter = useCallback((filter: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
    setFocusedIndex(-1);
  }, []);

  // Reset search/filters when closing
  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setActiveFilters(new Set());
    }
  }, [open]);

  // Focus search input when opening
  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open, searchable]);

  // Calculate dropdown position relative to viewport
  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !open) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < maxHeight + 20 && spaceAbove > spaceBelow;

    setDropdownPos({
      top: openUp ? undefined : rect.bottom + 6,
      bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
      left: rect.left,
      width: rect.width,
      openUp,
    });
  }, [open, maxHeight]);

  // Position on open
  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  // Update position on scroll/resize
  useEffect(() => {
    if (!open) return;
    const handleUpdate = () => updatePosition();
    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);
    return () => {
      window.removeEventListener('scroll', handleUpdate, true);
      window.removeEventListener('resize', handleUpdate);
    };
  }, [open, updatePosition]);

  // Close on outside click (checks both trigger container and portal dropdown)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return;

    // Don't intercept typing in search input
    if (searchable && (e.target as HTMLElement).tagName === 'INPUT' && e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') {
      return;
    }

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (open && focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
          onChange(filteredOptions[focusedIndex].value);
          setOpen(false);
          triggerRef.current?.focus();
        } else if (!open) {
          setOpen(true);
          setFocusedIndex(filteredOptions.findIndex(o => o.value === value));
        }
        break;
      case ' ':
        if (!searchable || !open) {
          e.preventDefault();
          if (open && focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
            onChange(filteredOptions[focusedIndex].value);
            setOpen(false);
            triggerRef.current?.focus();
          } else {
            setOpen(true);
            setFocusedIndex(filteredOptions.findIndex(o => o.value === value));
          }
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setFocusedIndex(filteredOptions.findIndex(o => o.value === value));
        } else {
          setFocusedIndex(prev => Math.min(prev + 1, filteredOptions.length - 1));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (open) {
          setFocusedIndex(prev => Math.max(prev - 1, 0));
        }
        break;
    }
  }, [disabled, open, focusedIndex, filteredOptions, value, onChange, searchable]);

  // Scroll focused item into view
  useEffect(() => {
    if (!open || focusedIndex < 0 || !listRef.current) return;
    const items = listRef.current.children;
    if (items[focusedIndex]) {
      (items[focusedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex, open]);

  const isSm = size === 'sm';

  // Portal dropdown rendered at document.body level to avoid parent clipping
  const dropdown = open && dropdownPos && typeof document !== 'undefined' && createPortal(
    <div
      ref={dropdownRef}
      className={cn(
        'fixed z-50 rounded-xl border border-white/[0.06] shadow-2xl',
        'bg-[var(--background)] backdrop-blur-xl',
        'animate-scale-in',
        dropdownPos.openUp ? 'origin-bottom' : 'origin-top'
      )}
      style={{
        top: dropdownPos.top,
        bottom: dropdownPos.bottom,
        left: dropdownPos.left,
        width: dropdownPos.width,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      }}
    >
      {/* Search bar */}
      {searchable && (
        <div className="px-2.5 pt-2 pb-1.5 border-b border-white/[0.04]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setFocusedIndex(0); }}
              placeholder="Search..."
              className="w-full h-8 pl-8 pr-3 text-xs bg-muted/50 border border-white/[0.04] rounded-lg outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/40"
            />
          </div>
        </div>
      )}

      {/* Filter chips */}
      {filterGroups && filterGroups.length > 0 && (
        <div className="px-2.5 py-1.5 border-b border-white/[0.04] flex flex-wrap gap-1">
          {filterGroups.map(group => (
            group.options.map(filter => (
              <button
                key={filter.value}
                onClick={(e) => { e.stopPropagation(); toggleFilter(filter.value); }}
                className={cn(
                  'px-2 py-0.5 rounded-md text-[10px] font-medium border transition-all',
                  activeFilters.has(filter.value)
                    ? (filter.color || 'bg-primary/20 text-primary border-primary/30')
                    : 'bg-muted/30 text-muted-foreground/60 border-white/[0.03] hover:bg-muted/50'
                )}
              >
                {filter.label}
              </button>
            ))
          ))}
        </div>
      )}

      {/* Scroll container */}
      <div
        ref={listRef}
        role="listbox"
        className={cn(
          'overflow-y-auto overscroll-contain py-1',
          '[&::-webkit-scrollbar]:w-[5px]',
          '[&::-webkit-scrollbar-track]:bg-transparent',
          '[&::-webkit-scrollbar-thumb]:bg-border/40',
          '[&::-webkit-scrollbar-thumb]:rounded-full',
          '[&::-webkit-scrollbar-thumb:hover]:bg-border/70',
        )}
        style={{ maxHeight }}
      >
        {filteredOptions.length === 0 ? (
          <div className="px-3.5 py-4 text-center text-xs text-muted-foreground/50">
            No models match your search
          </div>
        ) : filteredOptions.map((option, index) => {
          const isSelected = option.value === value;
          const isFocused = index === focusedIndex;

          return (
            <button
              key={option.value}
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
              onMouseEnter={() => setFocusedIndex(index)}
              className={cn(
                'w-full flex items-center gap-3 text-left transition-all duration-100',
                isSm ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2.5 text-sm',
                'border-l-2',
                isSelected
                  ? 'border-l-primary bg-primary/10 text-foreground'
                  : isFocused
                    ? 'border-l-primary/40 bg-primary/[0.06] text-foreground'
                    : 'border-l-transparent text-foreground/80 hover:bg-primary/[0.04]',
              )}
            >
              {/* Icon */}
              {option.icon && (
                <span className="shrink-0 text-muted-foreground/70">{option.icon}</span>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{option.label}</div>
                {option.description && (
                  <div className={cn(
                    'text-muted-foreground/60 mt-0.5 truncate',
                    isSm ? 'text-[10px]' : 'text-xs'
                  )}>
                    {option.description}
                  </div>
                )}
              </div>

              {/* Badge */}
              {option.badge && (
                <span className="shrink-0">{option.badge}</span>
              )}

              {/* Check mark */}
              {isSelected && (
                <Check className={cn(
                  'shrink-0 text-primary',
                  isSm ? 'h-3 w-3' : 'h-3.5 w-3.5'
                )} />
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom gradient fade when scrollable */}
      {filteredOptions.length > 5 && (
        <div className="h-px bg-gradient-to-r from-transparent via-border/30 to-transparent" />
      )}
    </div>,
    document.body
  );

  return (
    <div ref={containerRef} className={cn('relative', className)} onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls="nexus-select-listbox"
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => { if (!disabled) { setOpen(!open); setFocusedIndex(options.findIndex(o => o.value === value)); } }}
        className={cn(
          'w-full flex items-center justify-between gap-2 rounded-xl text-left transition-all duration-200',
          'border bg-[var(--input-bg)] text-foreground',
          isSm ? 'h-8 px-2.5 text-xs' : 'h-10 px-3.5 text-sm',
          open
            ? 'border-primary/40 ring-2 ring-primary/20 shadow-[0_0_12px_rgba(123,159,199,0.12)]'
            : 'border-white/[0.08] hover:border-white/[0.12]',
          disabled && 'opacity-40 cursor-not-allowed',
          triggerClassName
        )}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {icon && <span className="shrink-0 text-primary/70">{icon}</span>}
          <span className={cn('truncate', !selectedOption && 'text-muted-foreground')}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown className={cn(
          'shrink-0 text-muted-foreground transition-transform duration-200',
          isSm ? 'h-3.5 w-3.5' : 'h-4 w-4',
          open && 'rotate-180 text-primary'
        )} />
      </button>

      {dropdown}
    </div>
  );
}
