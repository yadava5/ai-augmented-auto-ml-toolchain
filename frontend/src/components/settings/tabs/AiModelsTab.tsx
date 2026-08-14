import { useSyncExternalStore } from 'react';
import { AlertTriangle, Cpu, MessageSquare, Gauge, Brain, Flame, Rocket } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { useLlmModelStore } from '@/stores/llmModelStore';
import { useLlmModelCatalog } from '@/hooks/useLlmModelCatalog';
import { useLlmConfigured } from '@/hooks/useLlmConfigured';
import { type ReasoningEffort } from '@/components/llm/modelOptions';
import {
  getToolVisibilityPref,
  setToolVisibilityPref,
  subscribeToolVisibilityPref,
} from '@/lib/generalPrefs';
import { cn } from '@/lib/utils';

const REASONING_PILL_META: {
  value: ReasoningEffort;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: 'low',    label: 'Low',        Icon: Gauge  },
  { value: 'medium', label: 'Medium',     Icon: Brain  },
  { value: 'high',   label: 'High',       Icon: Flame  },
  { value: 'xhigh',  label: 'Extra High', Icon: Rocket },
];

const TOOL_VISIBILITY_OPTIONS: { value: 'expanded' | 'collapsed' | 'hidden'; label: string }[] = [
  { value: 'expanded',  label: 'Expanded'  },
  { value: 'collapsed', label: 'Collapsed' },
  { value: 'hidden',    label: 'Hidden'    },
];

export function AiModelsTab() {
  const { selectedModel, setSelectedModel, reasoningEffort, setReasoningEffort } =
    useLlmModelStore();
  const { allModelOptions, isLoading } = useLlmModelCatalog();
  const { configured: llmConfigured } = useLlmConfigured();

  const toolVisibility = useSyncExternalStore(
    subscribeToolVisibilityPref,
    getToolVisibilityPref,
  );

  return (
    <div className="space-y-8">
      {/* Only an explicit `false` — `null` means we don't know yet. */}
      {llmConfigured === false ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
          <div className="space-y-1 text-sm text-yellow-700 dark:text-yellow-300">
            <p className="font-medium">No model API key is configured</p>
            <p>
              AI features are unavailable until a key is set. Add{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">OPENAI_API_KEY</code> to{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">backend/.env</code>, then
              restart the backend.
            </p>
          </div>
        </div>
      ) : null}

      <SettingsSection icon={Cpu} title="Default Model">
        <SettingsRow
          label="Default model"
          description="The model used for new AI conversations. Override per session in the chat composer."
        >
          <Select
            value={selectedModel}
            onValueChange={setSelectedModel}
            disabled={isLoading}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={isLoading ? 'Loading…' : 'Select model'} />
            </SelectTrigger>
            <SelectContent>
              {allModelOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          label="Default reasoning effort"
          description="Higher effort produces more thorough but slower responses"
        >
          <div className="flex items-center gap-1">
            {REASONING_PILL_META.map(({ value, label, Icon }) => {
              const active = reasoningEffort === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setReasoningEffort(value)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-transparent cursor-pointer transition-colors',
                    active
                      ? 'bg-muted text-foreground border-border'
                      : 'text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection icon={MessageSquare} title="Chat">
        <SettingsRow
          label="Tool call visibility"
          description="How to display tool calls and function invocations in chat messages"
        >
          <Select
            value={toolVisibility}
            onValueChange={(v) => setToolVisibilityPref(v as 'expanded' | 'collapsed' | 'hidden')}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOOL_VISIBILITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
