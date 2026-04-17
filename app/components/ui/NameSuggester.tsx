import React, { useState } from 'react';
import { suggestProductName } from '../../../lib/utils';

interface NameSuggesterProps {
  imagePreview: string | null;
  currentName: string;
  existingNames: string[];
  onSelect: (name: string) => void;
}

export function NameSuggester({ imagePreview, currentName, existingNames, onSelect }: NameSuggesterProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSuggest = async () => {
    if (loading || cooldown) return;
    setLoading(true);
    setSuggestions([]);
    setErrorMsg('');
    try {
      const result = await suggestProductName(imagePreview, currentName, existingNames);
      if (result.length === 0) {
        setErrorMsg('Sin sugerencias, intenta de nuevo');
      } else {
        setSuggestions(result);
      }
    } catch (err) {
      console.error('Error al sugerir nombre:', err);
      setErrorMsg('Error al conectar con Gemini');
    } finally {
      setLoading(false);
      setCooldown(true);
      setTimeout(() => setCooldown(false), 8000);
    }
  };

  return (
    <div className="flex gap-2 mt-1.5 flex-wrap items-center">
      <button
        type="button"
        onClick={handleSuggest}
        disabled={loading || cooldown}
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] hover:text-[#4A6310] bg-[#F9FAFA] hover:bg-[#E8F8B6]/40 border border-[#EAEAEC] hover:border-[#C8F169]/60 px-2.5 py-1 rounded-full transition-all disabled:opacity-50 touch-manipulation"
      >
        {loading ? (
          <>
            <span className="animate-spin inline-block w-2.5 h-2.5 border border-[#A1A1AA] border-t-transparent rounded-full" />
            ...
          </>
        ) : cooldown ? (
          <>⏳ Espera...</>
        ) : (
          <>✨ Sugerir</>
        )}
      </button>
      
      {errorMsg && <span className="text-[10px] text-red-400 font-medium">{errorMsg}</span>}
      
      {suggestions.map((s, i) => (
        <button
          key={i}
          type="button"
          onClick={() => { onSelect(s); setSuggestions([]); }}
          className="text-[10px] font-medium text-[#4A6310] bg-[#E8F8B6]/60 hover:bg-[#C8F169]/40 border border-[#C8F169]/40 px-2.5 py-1 rounded-full transition-all touch-manipulation"
        >
          {s}
        </button>
      ))}
    </div>
  );
}