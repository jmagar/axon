import { Button } from "@/components/ui/aurora/button";
import { isValidConnectionDraft, type SftpConnectionDraft } from "@/lib/sftpModel";

export function SftpConnectionDialog({
  draft,
  onChange,
  onSubmit,
  onClose,
}: {
  draft: SftpConnectionDraft;
  onChange: (draft: SftpConnectionDraft) => void;
  onSubmit: (draft: SftpConnectionDraft) => void;
  onClose: () => void;
}) {
  const valid = isValidConnectionDraft(draft);
  return (
    <div className="sftp-connection-dialog" role="dialog" aria-label="Add SFTP connection">
      <label>
        Label
        <input value={draft.label} onChange={(e) => onChange({ ...draft, label: e.target.value })} />
      </label>
      <label>
        Host
        <input value={draft.host} onChange={(e) => onChange({ ...draft, host: e.target.value })} />
      </label>
      <label>
        Port
        <input
          type="number"
          value={draft.port}
          onChange={(e) => onChange({ ...draft, port: Number(e.target.value) })}
        />
      </label>
      <label>
        Username
        <input value={draft.username} onChange={(e) => onChange({ ...draft, username: e.target.value })} />
      </label>
      <label>
        Private key path
        <input
          value={draft.privateKeyPath}
          onChange={(e) => onChange({ ...draft, privateKeyPath: e.target.value })}
        />
      </label>
      <div className="sftp-connection-dialog-actions">
        <Button variant="ghost" size="sm" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="aurora" size="sm" type="button" disabled={!valid} onClick={() => onSubmit(draft)}>
          Connect
        </Button>
      </div>
    </div>
  );
}
