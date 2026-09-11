import React, { useRef, useEffect } from 'react';
import styles from './glass-ui.module.css';
import { findCommittedMentionSpans } from '@/lib/mention-spans';

interface TextInputAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** When set, committed @tokens from this list are highlighted in the input. */
  highlightMentionTokens?: string[];
}

export const TextInputArea: React.FC<TextInputAreaProps> = ({
  value = '',
  placeholder = 'Ask',
  className = '',
  textareaRef,
  disabled = false,
  highlightMentionTokens,
  ...props
}) => {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Use the provided ref or our internal one
  const resolvedRef = (textareaRef as React.RefObject<HTMLTextAreaElement>) || internalRef;

  const highlightSpans =
    highlightMentionTokens && highlightMentionTokens.length > 0
      ? findCommittedMentionSpans(String(value), highlightMentionTokens)
      : [];
  const showMentionHighlight = highlightSpans.length > 0 || (highlightMentionTokens?.length ?? 0) > 0;

  const handleContainerClick = () => {
    if (!disabled && resolvedRef.current) {
      resolvedRef.current.focus();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (resolvedRef.current) {
      resolvedRef.current.style.height = 'auto';
      resolvedRef.current.style.height = `${resolvedRef.current.scrollHeight}px`;
    }
  }, [value, resolvedRef]);

  // Keep the highlight layer scrolled in sync with the textarea.
  useEffect(() => {
    const ta = resolvedRef.current;
    const hl = highlightRef.current;
    if (!ta || !hl) return;
    const sync = () => {
      hl.scrollTop = ta.scrollTop;
    };
    sync();
    ta.addEventListener('scroll', sync, { passive: true });
    return () => ta.removeEventListener('scroll', sync);
  }, [value, resolvedRef, showMentionHighlight]);

  const renderHighlighted = () => {
    const text = String(value);
    if (highlightSpans.length === 0) {
      return text.length > 0 ? text : '\u00a0';
    }
    const parts: React.ReactNode[] = [];
    let last = 0;
    for (const span of highlightSpans) {
      if (span.start > last) {
        parts.push(text.slice(last, span.start));
      }
      parts.push(
        <mark key={span.start} className={styles.mentionChip}>
          {text.slice(span.start, span.end)}
        </mark>
      );
      last = span.end;
    }
    if (last < text.length) {
      parts.push(text.slice(last));
    }
    return parts.length > 0 ? parts : '\u00a0';
  };

  return (
    <div 
      className={`${styles.textInputArea} ${className}`} 
      onClick={handleContainerClick}
    >
      {showMentionHighlight && (
        <div ref={highlightRef} className={styles.mentionHighlight} aria-hidden="true">
          {renderHighlighted()}
        </div>
      )}
      <textarea
        ref={resolvedRef}
        value={value}
        disabled={disabled}
        className={`${styles.realTextarea}${showMentionHighlight ? ` ${styles.realTextareaMentionOverlay}` : ''}`}
        placeholder={placeholder}
        rows={1}
        {...props}
      />
    </div>
  );
};