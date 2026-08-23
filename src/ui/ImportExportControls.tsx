import { useCallback, useRef } from 'react';
import type { Scenario, ValidationError } from '../scenario/types';
import { exportScenario } from '../scenario/exporter';
import { importScenario } from '../scenario/importer';

interface ImportExportControlsProps {
  scenario: Scenario | null;
  onImport: (scenario: Scenario) => void;
  onImportError: (errors: ValidationError[]) => void;
}

export function ImportExportControls({
  scenario,
  onImport,
  onImportError,
}: ImportExportControlsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    if (!scenario) return;
    const json = exportScenario(scenario);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scenario.faultline.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [scenario]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const result = importScenario(text);
        if (result.valid) {
          onImport(result.scenario);
        } else {
          onImportError(result.errors);
        }
      };
      reader.readAsText(file);
      // Reset input so same file can be re-imported
      e.target.value = '';
    },
    [onImport, onImportError],
  );

  return (
    <div className="import-export">
      <button
        className="btn btn--sm"
        onClick={handleExport}
        disabled={!scenario}
        aria-label="Export scenario"
      >
        ↓ Export
      </button>
      <button className="btn btn--sm" onClick={handleImport} aria-label="Import scenario">
        ↑ Import
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.faultline.json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        aria-hidden="true"
      />
    </div>
  );
}
