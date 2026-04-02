import { toast } from 'sonner';

/** Success toast with checkmark — use for completed operations */
export function toastSuccess(title: string, description?: string) {
  toast.success(title, { description });
}

/** Error toast — use for failures */
export function toastError(title: string, description?: string) {
  toast.error(title, { description });
}

/** Info toast — use for status updates */
export function toastInfo(title: string, description?: string) {
  toast.info(title, { description });
}

/** Warning toast */
export function toastWarning(title: string, description?: string) {
  toast.warning(title, { description });
}
