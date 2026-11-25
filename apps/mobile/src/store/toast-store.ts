import { create } from 'zustand';

type ToastTone = 'verdant' | 'danger' | 'amber';

type ToastState = {
  message: string | null;
  tone: ToastTone;
  showToast: (message: string, tone?: ToastTone) => void;
  clearToast: () => void;
};

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  tone: 'verdant',
  showToast: (message, tone = 'verdant') => {
    if (timer) clearTimeout(timer);
    set({ message, tone });
    timer = setTimeout(() => set({ message: null }), 2800);
  },
  clearToast: () => {
    if (timer) clearTimeout(timer);
    set({ message: null });
  },
}));
