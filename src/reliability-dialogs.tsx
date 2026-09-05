import { AlertTriangle, Clock3, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "./i18n";
import type { RecoveryInfo } from "./types";

type UnsavedProps = {
  open: boolean;
  destination: string;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

export function UnsavedChangesDialog({
  open,
  destination,
  saving,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedProps) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="reliability-backdrop" role="presentation">
      <section
        className="reliability-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        data-testid="unsaved-dialog"
      >
        <div className="reliability-dialog__icon warning">
          <AlertTriangle aria-hidden="true" />
        </div>
        <div className="reliability-dialog__copy">
          <small>{t("UNSAVED WORK")}</small>
          <h2 id="unsaved-title">{t("Save changes before continuing?")}</h2>
          <p>
            {t(
              "Your latest edits have a recovery copy, but they are not in the project file.",
            )}{" "}
            {destination}
          </p>
        </div>
        <div className="reliability-dialog__actions">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={saving}
            data-testid="cancel-transition"
          >
            {t("Cancel")}
          </Button>
          <Button variant="outline" onClick={onDiscard} disabled={saving}>
            {t("Discard changes")}
          </Button>
          <Button
            onClick={onSave}
            disabled={saving}
            data-testid="save-and-continue"
          >
            {saving ? t("Saving…") : t("Save and continue")}
          </Button>
        </div>
      </section>
    </div>
  );
}

type RecoveryProps = {
  recovery: RecoveryInfo | null;
  busy: boolean;
  onRestore: () => void;
  onDiscard: () => void;
};

export function RecoveryDialog({
  recovery,
  busy,
  onRestore,
  onDiscard,
}: RecoveryProps) {
  const { language, t } = useI18n();
  if (!recovery) return null;
  const savedAt = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(recovery.savedAt));
  return (
    <div className="reliability-backdrop" role="presentation">
      <section
        className="reliability-dialog recovery-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
        data-testid="recovery-dialog"
      >
        <div className="reliability-dialog__icon recovery">
          <RotateCcw aria-hidden="true" />
        </div>
        <div className="reliability-dialog__copy">
          <small>{t("RECOVERY AVAILABLE")}</small>
          <h2 id="recovery-title">{t("Continue where you left off")}</h2>
          <p>
            {t(
              "SugarEDA found an autosaved project from an interrupted session.",
            )}
          </p>
          <div className="recovery-card">
            <div>
              <strong>{recovery.projectName}</strong>
              <span>
                {recovery.originalPath || t("Not saved to a project file yet")}
              </span>
            </div>
            <dl>
              <div>
                <dt>
                  <Clock3 aria-hidden="true" /> {t("Autosaved")}
                </dt>
                <dd>{savedAt}</dd>
              </div>
              <div>
                <dt>
                  <ShieldCheck aria-hidden="true" /> {t("Recovered content")}
                </dt>
                <dd>
                  {recovery.componentCount} {t("components")} ·{" "}
                  {recovery.wireCount} {t("wires")}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="reliability-dialog__actions">
          <Button variant="ghost" onClick={onDiscard} disabled={busy}>
            {t("Discard recovery")}
          </Button>
          <Button
            onClick={onRestore}
            disabled={busy}
            data-testid="restore-recovery"
          >
            {busy ? t("Restoring…") : t("Restore project")}
          </Button>
        </div>
      </section>
    </div>
  );
}
