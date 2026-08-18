import React, { ButtonHTMLAttributes } from 'react';
import styles from './glass-ui.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  label?: React.ReactNode;
}

export const PillButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ icon, label, className = '', children, ...props }, ref) => {
    return (
      <button ref={ref} className={`${styles.pillBtn} ${className}`} {...props}>
        {icon}
        {label && <span className="label">{label}</span>}
        {children}
      </button>
    );
  }
);
PillButton.displayName = 'PillButton';

export const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ icon, className = '', children, ...props }, ref) => {
    return (
      <button ref={ref} className={`${styles.pillBtn} ${styles.iconOnly} ${className}`} {...props}>
        {icon}
        {children}
      </button>
    );
  }
);
IconButton.displayName = 'IconButton';

export const PrimaryAction = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ icon, className = '', children, ...props }, ref) => {
    return (
      <button ref={ref} className={`${styles.primaryBtn} ${className}`} {...props}>
        {icon}
        {children}
      </button>
    );
  }
);
PrimaryAction.displayName = 'PrimaryAction';
