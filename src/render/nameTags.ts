import * as THREE from 'three';
import type { RivalCar } from '../core/types';
import { slotCss } from '../core/playerColors';

/**
 * Floating name plates over the rival cars.
 *
 * It lives in `src/render` rather than `src/ui` even though it draws with DOM, because what
 * it actually is, is a camera-driven overlay: the only thing it does is project a world
 * position through the same camera the scene uses. Nothing here reads game state — only the
 * interpolated rivals and the camera.
 *
 * Drawn as DOM instead of sprites so a name costs no draw call, no texture upload and no
 * atlas, and stays crisp at any resolution the governor picks.
 *
 * Performance contract: one element per rival, created once. Per frame it writes only
 * `transform` and `opacity`, never reads geometry back (so it cannot force a layout), and
 * skips the write entirely when the tag has not moved a pixel.
 */
export interface NameTags {
  /** Project and place every tag. Call once per rendered frame. */
  update(camera: THREE.Camera, rivals: readonly RivalCar[]): void;
  dispose(): void;
}

/** Height above the road the tag is anchored to (m): just over the roof. */
const ANCHOR_Y = 1.75;
/** Beyond this the tag is not drawn at all (m). */
const MAX_DISTANCE = 120;
/** Fade starts here and reaches nothing at `MAX_DISTANCE` (m). */
const FADE_DISTANCE = 80;

export function createNameTags(root: HTMLElement, rivals: readonly RivalCar[]): NameTags {
  const layer = document.createElement('div');
  layer.className = 'rb-tags';
  root.appendChild(layer);

  const anchor = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();

  const tags = rivals.map((rival) => {
    const el = document.createElement('div');
    el.className = 'rb-tag';
    el.style.color = slotCss(rival.slot);
    el.textContent = rival.name;
    el.hidden = true;
    layer.appendChild(el);
    return { el, shownX: -1, shownY: -1, shownOpacity: -1, visible: false };
  });

  return {
    update(camera, list) {
      const width = window.innerWidth;
      const height = window.innerHeight;
      camera.getWorldPosition(cameraPosition);

      for (let i = 0; i < tags.length && i < list.length; i++) {
        const tag = tags[i];
        const rival = list[i];
        const dx = rival.x - cameraPosition.x;
        const dz = rival.z - cameraPosition.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (!rival.present || distance > MAX_DISTANCE) {
          if (tag.visible) {
            tag.el.hidden = true;
            tag.visible = false;
          }
          continue;
        }

        anchor.set(rival.x, ANCHOR_Y, rival.z);
        anchor.project(camera);
        // Behind the camera, or off the edge of the frame with a little margin.
        if (anchor.z > 1 || anchor.x < -1.3 || anchor.x > 1.3 || anchor.y < -1.3 || anchor.y > 1.3) {
          if (tag.visible) {
            tag.el.hidden = true;
            tag.visible = false;
          }
          continue;
        }

        const x = Math.round(((anchor.x + 1) / 2) * width);
        const y = Math.round(((1 - anchor.y) / 2) * height);
        const opacity = distance <= FADE_DISTANCE
          ? 1
          : Math.max(0, 1 - (distance - FADE_DISTANCE) / (MAX_DISTANCE - FADE_DISTANCE));
        // Two decimal places is finer than the eye can tell and stops opacity churning.
        const quantised = Math.round(opacity * 100) / 100;

        if (!tag.visible) {
          tag.el.hidden = false;
          tag.visible = true;
        }
        if (x !== tag.shownX || y !== tag.shownY) {
          tag.el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
          tag.shownX = x;
          tag.shownY = y;
        }
        if (quantised !== tag.shownOpacity) {
          tag.el.style.opacity = `${quantised}`;
          tag.shownOpacity = quantised;
        }
      }
    },

    dispose() {
      layer.remove();
    },
  };
}
