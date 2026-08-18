import React from 'react';
import styles from './glass-ui.module.css';

export const BackgroundSystem: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className={styles.bgSystem}>
      <div className={styles.bgNoise}></div>
      <div className={styles.bgGridXLeft}></div>
      <div className={styles.bgGridXRight}></div>
      <div className={styles.bgGridYTop}></div>
      <div className={styles.bgGridYBottom}></div>
      <div className={styles.contentWrapper}>
        {children}
      </div>
    </div>
  );
};
