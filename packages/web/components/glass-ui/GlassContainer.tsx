import React from 'react';
import styles from './glass-ui.module.css';

interface GlassContainerProps {
  children: React.ReactNode;
  className?: string;
  isFocused?: boolean;
}

export const GlassContainer: React.FC<GlassContainerProps> = ({ children, className = '', isFocused = false }) => {
  return (
    <div 
      className={`${styles.glassContainer} ${isFocused ? styles.glassContainerFocus : ''} ${className}`}
    >
      {children}
    </div>
  );
};
