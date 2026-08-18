import React, { useRef, useEffect } from 'react';
import styles from './glass-ui.module.css';

interface TextInputAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export const TextInputArea: React.FC<TextInputAreaProps> = ({
  value = '',
  placeholder = 'Ask',
  className = '',
  textareaRef,
  disabled = false,
  ...props
}) => {
  const internalRef = useRef<HTMLTextAreaElement>(null);

  // Use the provided ref or our internal one
  const resolvedRef = (textareaRef as React.RefObject<HTMLTextAreaElement>) || internalRef;

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

  return (
    <div 
      className={`${styles.textInputArea} ${className}`} 
      onClick={handleContainerClick}
    >
      {/* One placeholder, the browser's own. There used to be two — an
          absolutely-positioned span while blurred and the native one while
          focused — which sit in different places, so the hint visibly jumped
          the moment you clicked into the box. */}
      <textarea
        ref={resolvedRef}
        value={value}
        disabled={disabled}
        className={styles.realTextarea}
        placeholder={placeholder}
        rows={1}
        {...props}
      />
    </div>
  );
};