# Pastas por entrevistado no export Obsidian

**Data:** 2026-09-24  
**Status:** Implementado (v1)  
**Escopo:** Medium/Large — frontend + migration SQLite + fluxo de gravação/export

## Contexto

O usuário conduz entrevistas e usa a feature beta **Export to Obsidian**. Hoje os arquivos vão para:

`{vaultPath}/{YYYY-MM-DD-titulo}/`

Deseja-se cadastrar nomes (entrevistados) nas configurações e, na Home, escolher quem está sendo entrevistado. No export, inserir uma pasta extra **entre** o vault e a subpasta da reunião:

`{vaultPath}/{NomeEntrevistado}/{YYYY-MM-DD-titulo}/`

Se ninguém for escolhido, o comportamento permanece o de hoje (sem pasta intermediária).

## Decisões do produto

| Tópico | Decisão |
|--------|---------|
| Estrutura de path | **A:** `vault / pessoa / subpasta-reunião` |
| Sem seleção | **A:** export igual ao atual |
| Snapshot da pessoa | No **início da gravação** (inclui auto-start pela sidebar) |
| Dropdown na Home | Visível apenas com beta **Export to Obsidian** ligado |
| Opção vazia no dropdown | **“Nenhuma (padrão do vault)”** |
| Excluir pessoa do CRUD | Não altera reuniões já salvas (segmento copiado na reunião) |
| UI do CRUD | Settings → Beta → seção Export to Obsidian |

## Abordagem escolhida

**Coluna SQLite + snapshot na gravação** (rejeitada: só `localStorage` por `meetingId`; rejeitada: dropdown na hora do export).

Motivo: o segmento de pasta pertence à reunião gravada, não ao estado atual do dropdown.

## Modelo de dados

### Configuração — lista de entrevistados

Armazenamento: `localStorage`, chave dedicada (ex.: `obsidianInterviewees`), independente de `obsidianExportSettings`.

```ts
interface ObsidianInterviewee {
  id: string;    // uuid
  label: string; // ex.: "Maria Silva" — dropdown e nome de pasta após sanitização
}
```

- **Criar/editar:** `label` trim, não vazio; duplicatas de label permitidas na v1 (ids distintos).
- **Sanitização para pasta:** alinhar às regras já usadas no export Obsidian (`obsidian_export/writer.rs`: remover/substituir caracteres inválidos de path Windows, trim, colapsar vazio → tratar como “sem segmento” no snapshot se sanitizar para vazio).
- **Última seleção do dropdown:** `localStorage` (ex.: `obsidianSelectedIntervieweeId`) para conveniência ao abrir a Home; não substitui o snapshot da gravação.

### Reunião — segmento persistido

Migration SQL:

```sql
ALTER TABLE meetings ADD COLUMN obsidian_vault_segment TEXT;
```

- Valor: string sanitizada copiada no save (nullable).
- `NULL` ou ausente: export sem pasta intermediária.

### Sessão de gravação

No `start` da gravação:

- Ler entrevistado selecionado no dropdown (ou “nenhuma”).
- Gravar em `sessionStorage` (ex.: `recording_obsidian_vault_segment`) o segmento sanitizado ou string vazia.
- Limpar ou sobrescrever ao iniciar nova gravação.

No **save** (`api_save_transcript`):

- Parâmetro opcional `obsidian_vault_segment: Option<String>`.
- Persistir na linha `meetings` criada/atualizada.

### Recovery (IndexedDB)

Campo opcional em `MeetingMetadata` do recovery (ex.: `obsidianVaultSegment?: string`), preenchido no `recording-started` junto com o snapshot da sessão; enviado no `saveMeeting` ao recuperar.

## Fluxo de export

1. Carregar `vaultPath` de `obsidianExportSettings`.
2. Carregar `obsidian_vault_segment` da reunião (metadata / objeto `meeting`).
3. Montar path efetivo no **frontend**:

   `effectiveVault = segment ? join(vaultPath, segment) : vaultPath`

4. Invocar `export_meeting_to_obsidian_command` com `vaultPath: effectiveVault` (Rust inalterado na lógica `vault.join(subfolder)`).

Auto-export após summary usa o mesmo hook com o `meetingId` da reunião.

## Componentes e arquivos (planejado)

| Área | Mudança |
|------|---------|
| `lib/obsidian-interviewees.ts` | CRUD + load/save localStorage + sanitização |
| `lib/obsidian-vault-path.ts` | `buildEffectiveObsidianVaultPath(base, segment?)` |
| `BetaSettings.tsx` / `ObsidianExportConfig` | UI CRUD |
| `IntervieweeFolderSelect.tsx` (novo) | Dropdown reutilizável |
| `VirtualizedTranscriptView.tsx` | Dropdown abaixo do welcome (estado vazio, não gravando) |
| `useRecordingStart.ts` | Snapshot → `sessionStorage` |
| `useRecordingStop.ts` | Passar segmento no `saveMeeting` |
| `storageService.ts` + `api_save_transcript` | Parâmetro opcional |
| `MeetingsRepository` + migration | Coluna + leitura/escrita |
| `api_get_meeting_metadata` + tipos TS | Campo `obsidian_vault_segment` |
| `useObsidianExport.ts` | Path efetivo + segmento da reunião |
| `useTranscriptRecovery.ts` | Segmento no save de recovery |
| `TranscriptContext.tsx` | Opcional: persistir segmento no IndexedDB no recording-started |

`TranscriptView.tsx`: manter paridade só se ainda usado em alguma rota; Home usa `VirtualizedTranscriptView` via `TranscriptPanel`.

## UI — CRUD (Beta)

- Seção **“Pastas por entrevistado”** abaixo do vault path.
- Help text: pasta extra entre o vault e cada reunião exportada.
- Lista com editar/excluir; input + botão adicionar.
- Sem reordenação na v1.

## UI — Home

- Dropdown centralizado abaixo de “Start recording to see live transcription”.
- Label sugerida: **“Entrevistado (pasta no Obsidian)”**.
- Desabilitado ou oculto durante gravação (snapshot já feito no start).

## Requisitos (IDs para rastreio)

| ID | Requisito |
|----|-----------|
| OBS-INT-1 | Usuário pode cadastrar, editar e excluir nomes na seção Obsidian (Beta). |
| OBS-INT-2 | Nomes inválidos para filesystem são sanitizados antes de usar como pasta. |
| OBS-INT-3 | Home exibe dropdown de entrevistados quando Obsidian export beta está ativo. |
| OBS-INT-4 | Opção explícita sem pasta intermediária no dropdown. |
| OBS-INT-5 | No início da gravação, a escolha (ou vazio) é fixada para essa sessão. |
| OBS-INT-6 | Ao salvar a reunião, o segmento é persistido em `meetings.obsidian_vault_segment`. |
| OBS-INT-7 | Export manual e auto-export usam `vaultPath` + segmento da reunião + subpasta existente. |
| OBS-INT-8 | Reunião sem segmento exporta como hoje. |
| OBS-INT-9 | Recovery preserva segmento quando aplicável no save. |

## Testes

- Unit: sanitização de `label` → segmento de pasta.
- Unit: `buildEffectiveObsidianVaultPath` com/sem segmento, paths Windows.
- Integração leve: save com segmento retorna metadata com campo preenchido (se houver testes de API no projeto).

## Fora de escopo (v1)

- Sincronizar lista de entrevistados entre dispositivos.
- Editar pasta de reunião já salva na UI de detalhes.
- Bloquear gravação sem entrevistado selecionado.
- i18n completo do app — apenas strings desta feature em PT onde forem adicionadas.

## Próximo passo

Após revisão deste arquivo: plano de implementação (`writing-plans` / tasks) e execução.
