"use client";

import styles from "./FinalBadge.module.css";

/**
 * Shared yellow "FINAL" corner badge. Used by Canvas tiles and AssetLibrary
 * cells so the marker styling stays in lockstep across surfaces. Phase 10
 * dropped the dedicated Final Composition slot in favor of this badge as
 * the sole visual marker.
 */
export function FinalBadge() {
  return <span className={styles.badge}>FINAL</span>;
}

/** Class to mix into a container that also wants the gold accent border
 *  on the pinned cell/tile. */
export const finalContainerClass: string = styles.container;
