import { ref, onMounted, onBeforeUnmount } from 'vue';

const MOBILE_BREAKPOINT = 768;

// Singleton reactive ref — shared across all callers
const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false);

let listenerCount = 0;

function handleResize() {
  isMobile.value = window.innerWidth < MOBILE_BREAKPOINT;
}

export function useIsMobile() {
  onMounted(() => {
    if (listenerCount === 0) {
      window.addEventListener('resize', handleResize, { passive: true });
    }
    listenerCount++;
    // Sync on mount in case SSR default was wrong
    isMobile.value = window.innerWidth < MOBILE_BREAKPOINT;
  });

  onBeforeUnmount(() => {
    listenerCount--;
    if (listenerCount === 0) {
      window.removeEventListener('resize', handleResize);
    }
  });

  return { isMobile };
}
