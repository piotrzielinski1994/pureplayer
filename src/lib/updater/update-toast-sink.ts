import type { UpdateToastSink } from "@pziel/pureui";
import type { ToastHandle } from "@/components/ui/toast";

type ShowToast = (
  message: string,
  options?: {
    persistent?: boolean;
    action?: { label: string; onClick: () => void };
  },
) => ToastHandle;

// Adapts pureplayer's ToastProvider `show` to pureui's toast-lib-agnostic
// UpdateToastSink port. present() opens the persistent "Update now" toast;
// progress() replaces the action button with the download label on the SAME
// handle. pureplayer shows no Installing…/error toast, so those steps no-op -
// the semantic handle lets pureui drive the flow without pureplayer growing
// toasts it never had.
export function createPlayerUpdateToastSink(show: ShowToast): UpdateToastSink {
  return {
    present: ({ message, onUpdateNow }) => {
      const handle = show(message, {
        persistent: true,
        action: { label: "Update now", onClick: onUpdateNow },
      });
      return {
        progress: (label) => {
          handle.clearAction();
          handle.update(label);
        },
        installing: () => {},
        failed: () => {},
      };
    },
  };
}
