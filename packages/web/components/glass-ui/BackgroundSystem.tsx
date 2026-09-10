import React from 'react';
import styles from './glass-ui.module.css';

/**
 * The app's background layer.
 *
 * Used to stack a noise overlay and four decorative grid lines over a mesh
 * gradient. All of it is gone with the flat theme, leaving one element that
 * paints the canvas — but the component stays: it is what gives the page its
 * full-height flex column, and .contentWrapper is the stacking context every
 * view is laid out inside.
 */
export const BackgroundSystem: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className={styles.bgSystem}>
      <div className={styles.contentWrapper}>
        {children}
      </div>
    </div>
  );
};
