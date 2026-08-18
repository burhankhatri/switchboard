import React, { useRef, useState, useEffect } from 'react';
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
  const [isFocused, setIsFocused] = useState(false);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  
  // Use the provided ref or our internal one
  const resolvedRef = (textareaRef as React.RefObject<HTMLTextAreaElement>) || internalRef;

  const handleContainerClick = () => {
    if (!disabled && resolvedRef.current) {
      resolvedRef.current.focus();
    }
  };

  const showCustomPlaceholder = value === '';

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
      {showCustomPlaceholder && !isFocused && (
        <div className={styles.customPlaceholderContainer}>
          <span className={styles.placeholder}>{placeholder}</span>
        </div>
      )}
      
      <textarea
        ref={resolvedRef}
        value={value}
        disabled={disabled}
        className={styles.realTextarea}
        placeholder={isFocused && showCustomPlaceholder ? placeholder : ''}
        rows={1}
        onFocus={(e) => {
          setIsFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setIsFocused(false);
          props.onBlur?.(e);
        }}
        {...props}
      />
    </div>
  );
};