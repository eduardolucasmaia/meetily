'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import {
  createInterviewee,
  loadObsidianInterviewees,
  saveObsidianInterviewees,
  sanitizeObsidianVaultSegment,
  type ObsidianInterviewee,
} from '@/lib/obsidian-interviewees';
import { toast } from 'sonner';

export function ObsidianIntervieweesManager() {
  const [interviewees, setInterviewees] = useState<ObsidianInterviewee[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const persist = useCallback((next: ObsidianInterviewee[]) => {
    setInterviewees(next);
    saveObsidianInterviewees(next);
  }, []);

  useEffect(() => {
    setInterviewees(loadObsidianInterviewees());
  }, []);

  const handleAdd = () => {
    const created = createInterviewee(newLabel);
    if (!created) {
      toast.error('Nome inválido para pasta');
      return;
    }
    persist([...interviewees, created]);
    setNewLabel('');
  };

  const startEdit = (person: ObsidianInterviewee) => {
    setEditingId(person.id);
    setEditLabel(person.label);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditLabel('');
  };

  const saveEdit = () => {
    if (!editingId) return;
    const trimmed = editLabel.trim();
    if (!trimmed || !sanitizeObsidianVaultSegment(trimmed)) {
      toast.error('Nome inválido para pasta');
      return;
    }
    persist(
      interviewees.map((p) => (p.id === editingId ? { ...p, label: trimmed } : p))
    );
    cancelEdit();
  };

  const handleDelete = (id: string) => {
    persist(interviewees.filter((p) => p.id !== id));
    if (editingId === id) cancelEdit();
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-gray-700">Pastas por entrevistado</p>
        <p className="mt-1 text-xs text-gray-500">
          Cada nome cria uma pasta extra entre o vault e as reuniões exportadas.
        </p>
      </div>

      {interviewees.length > 0 && (
        <ul className="space-y-2">
          {interviewees.map((person) => (
            <li
              key={person.id}
              className="flex items-center gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2"
            >
              {editingId === person.id ? (
                <>
                  <Input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="h-8 flex-1 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit();
                      if (e.key === 'Escape') cancelEdit();
                    }}
                  />
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={saveEdit}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={cancelEdit}>
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-gray-800">{person.label}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => startEdit(person)}
                    title="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-red-600 hover:text-red-700"
                    onClick={() => handleDelete(person.id)}
                    title="Excluir"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Nome da pessoa"
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
        />
        <Button type="button" variant="outline" onClick={handleAdd}>
          Adicionar
        </Button>
      </div>
    </div>
  );
}
