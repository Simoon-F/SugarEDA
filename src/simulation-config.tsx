import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import type { BackendStatus, SimulationProfile } from "./types";
import type { ProbeOption } from "./simulation-check";
import { useI18n } from "./i18n";

function Field({
  label,
  value,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label>
      {label}
      <input
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft.trim());
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function SimulationConfig({
  profile,
  profiles,
  probeOptions,
  path,
  status,
  onPath,
  onRefresh,
  onUpdate,
  onSelectProfile,
  onAddProfile,
  onDeleteProfile,
}: {
  profile: SimulationProfile;
  profiles: SimulationProfile[];
  probeOptions: ProbeOption[];
  path: string;
  status: BackendStatus;
  onPath: (path: string) => void;
  onRefresh: () => void;
  onUpdate: (change: Partial<SimulationProfile>) => void;
  onSelectProfile: (id: string) => void;
  onAddProfile: () => void;
  onDeleteProfile: () => void;
}) {
  const { t } = useI18n();
  const analysis = profile.analysis;
  return (
    <div className="simulation-config">
      <div className="profile-fields">
        <label>
          {t("SIMULATION PROFILE")}
          <Select value={profile.id} onValueChange={onSelectProfile}>
            <SelectTrigger aria-label={t("SIMULATION PROFILE")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Field
          label={t("PROFILE NAME")}
          value={profile.name}
          onCommit={(name) => name && onUpdate({ name })}
        />
        <Button variant="outline" onClick={onAddProfile}>
          <Plus /> {t("New profile")}
        </Button>
        <Button
          variant="outline"
          onClick={onDeleteProfile}
          disabled={profiles.length <= 1}
          title={t("Delete profile")}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="analysis-fields">
        <label>
          {t("ANALYSIS")}
          <Select
            value={analysis.type}
            onValueChange={(type) => {
              const next =
                type === "operatingPoint"
                  ? { type: "operatingPoint" as const }
                  : type === "transient"
                    ? { type: "transient" as const, step: "10u", stop: "30m" }
                    : type === "dcSweep"
                      ? {
                          type: "dcSweep" as const,
                          source: "V1",
                          start: "0",
                          stop: "5",
                          step: "0.1",
                        }
                      : {
                          type: "acSweep" as const,
                          variation: "dec",
                          points: 100,
                          start: "10",
                          stop: "1Meg",
                        };
              onUpdate({ analysis: next });
            }}
          >
            <SelectTrigger aria-label={t("ANALYSIS")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="operatingPoint">
                {t("Operating point")}
              </SelectItem>
              <SelectItem value="transient">{t("Transient")}</SelectItem>
              <SelectItem value="dcSweep">{t("DC sweep")}</SelectItem>
              <SelectItem value="acSweep">{t("AC sweep")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {analysis.type === "transient" && (
          <>
            <Field
              label={t("TIME STEP")}
              value={analysis.step}
              onCommit={(step) => onUpdate({ analysis: { ...analysis, step } })}
            />
            <Field
              label={t("STOP TIME")}
              value={analysis.stop}
              onCommit={(stop) => onUpdate({ analysis: { ...analysis, stop } })}
            />
          </>
        )}
        {analysis.type === "dcSweep" && (
          <>
            <Field
              label={t("SOURCE")}
              value={analysis.source}
              onCommit={(source) =>
                onUpdate({ analysis: { ...analysis, source } })
              }
            />
            <Field
              label={t("START")}
              value={analysis.start}
              onCommit={(start) =>
                onUpdate({ analysis: { ...analysis, start } })
              }
            />
            <Field
              label={t("STOP")}
              value={analysis.stop}
              onCommit={(stop) => onUpdate({ analysis: { ...analysis, stop } })}
            />
            <Field
              label={t("STEP")}
              value={analysis.step}
              onCommit={(step) => onUpdate({ analysis: { ...analysis, step } })}
            />
          </>
        )}
        {analysis.type === "acSweep" && (
          <>
            <Field
              label={t("POINTS / DECADE")}
              value={String(analysis.points)}
              onCommit={(points) =>
                onUpdate({
                  analysis: {
                    ...analysis,
                    points: Math.max(1, Math.min(10000, Number(points) || 1)),
                  },
                })
              }
            />
            <Field
              label={t("START FREQUENCY")}
              value={analysis.start}
              onCommit={(start) =>
                onUpdate({ analysis: { ...analysis, start } })
              }
            />
            <Field
              label={t("STOP FREQUENCY")}
              value={analysis.stop}
              onCommit={(stop) => onUpdate({ analysis: { ...analysis, stop } })}
            />
          </>
        )}
      </div>
      <div className="solver-fields">
        <div className="probe-selector">
          <span>{t("PROBES FROM SCHEMATIC")}</span>
          <div>
            {probeOptions.map((option) => {
              const selected = profile.signals.some(
                (signal) => signal.toLowerCase() === option.value.toLowerCase(),
              );
              return (
                <button
                  key={option.value}
                  type="button"
                  className={option.kind}
                  aria-pressed={selected}
                  onClick={() =>
                    onUpdate({
                      signals: selected
                        ? profile.signals.filter(
                            (signal) =>
                              signal.toLowerCase() !==
                              option.value.toLowerCase(),
                          )
                        : [...profile.signals, option.value],
                    })
                  }
                >
                  <i>{option.kind === "voltage" ? "V" : "I"}</i>
                  {option.label}
                </button>
              );
            })}
            {profile.signals
              .filter(
                (signal) =>
                  !probeOptions.some(
                    (option) =>
                      option.value.toLowerCase() === signal.toLowerCase(),
                  ),
              )
              .map((signal) => (
                <button
                  key={signal}
                  type="button"
                  className="unavailable"
                  aria-pressed="true"
                  title={t("Probe is unavailable; click to remove")}
                  onClick={() =>
                    onUpdate({
                      signals: profile.signals.filter(
                        (item) => item !== signal,
                      ),
                    })
                  }
                >
                  ! {signal}
                </button>
              ))}
            {!probeOptions.length && (
              <em>{t("Place a network label to make it available here")}</em>
            )}
          </div>
        </div>
        <Field
          label={t("NGSPICE PATH · OPTIONAL")}
          value={path}
          onCommit={onPath}
          placeholder={t("Bundled engine")}
        />
        <Button variant="outline" onClick={onRefresh}>
          {t("Detect")}
        </Button>
      </div>
      <div className={status.available ? "config-status ok" : "config-status"}>
        <span>{status.available ? "✓" : "!"}</span>
        <div>
          <strong>
            {status.available ? t("Solver ready") : t("Solver unavailable")}
          </strong>
          <p>{t(status.message)}</p>
          {analysis.type === "acSweep" && (
            <p>
              {t(
                "Set a voltage or current source to AC 1. Results include magnitude and phase.",
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
