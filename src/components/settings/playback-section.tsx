import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/lib/settings/settings-context";

export function PlaybackSection() {
  const { settings, saveRevealTransportOnHover } = useSettings();

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-medium">Playback</h2>
      <div className="mt-2 flex items-center justify-between py-1.5">
        <div className="flex flex-col">
          <span className="text-sm">Reveal transport bar on hover</span>
          <span className="text-xs text-muted-foreground">
            When the transport bar is hidden, show it while the mouse is over
            the video.
          </span>
        </div>
        <Switch
          aria-label="Reveal transport bar on hover"
          checked={settings.revealTransportOnHover}
          onCheckedChange={saveRevealTransportOnHover}
        />
      </div>
    </section>
  );
}
