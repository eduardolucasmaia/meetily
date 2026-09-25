'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  loadObsidianInterviewees,
  loadSelectedIntervieweeId,
  saveSelectedIntervieweeId,
  type ObsidianInterviewee,
} from '@/lib/obsidian-interviewees';

const NONE_VALUE = '__none__';

interface IntervieweeFolderSelectProps {
  disabled?: boolean;
  className?: string;
}

export function IntervieweeFolderSelect({ disabled, className }: IntervieweeFolderSelectProps) {
  const [mounted, setMounted] = useState(false);
  const [interviewees, setInterviewees] = useState<ObsidianInterviewee[]>([]);
  const [selectedId, setSelectedId] = useState<string>(NONE_VALUE);

  const refresh = useCallback(() => {
    setInterviewees(loadObsidianInterviewees());
    const stored = loadSelectedIntervieweeId();
    setSelectedId(stored ?? NONE_VALUE);
  }, []);

  useEffect(() => {
    setMounted(true);
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'obsidianInterviewees' || e.key === 'obsidianSelectedIntervieweeId') {
        refresh();
      }
    };
    const onCustom = () => refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener('obsidian-interviewees-updated', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('obsidian-interviewees-updated', onCustom);
    };
  }, [refresh]);

  const handleChange = (value: string) => {
    setSelectedId(value);
    saveSelectedIntervieweeId(value === NONE_VALUE ? null : value);
  };

  if (!mounted) {
    return null;
  }

  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-600 mb-1.5 text-center">
        Entrevistado (pasta no Obsidian)
      </label>
      <Select value={selectedId} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger className="w-full max-w-sm mx-auto">
          <SelectValue placeholder="Selecione..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>Nenhuma (padrão do vault)</SelectItem>
          {interviewees.map((person) => (
            <SelectItem key={person.id} value={person.id}>
              {person.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
