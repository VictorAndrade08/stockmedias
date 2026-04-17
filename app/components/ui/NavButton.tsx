import React from 'react';

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

export function NavButton({ active, onClick, icon, label }: NavButtonProps) {
  return (
    <button 
      onClick={onClick} 
      className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-[1.25rem] transition-all duration-200 ${
        active 
          ? 'bg-[#1A1A1A] text-white shadow-lg shadow-black/5 font-medium' 
          : 'text-[#71717A] hover:bg-[#EAEAEC]/60 hover:text-[#111111] font-medium'
      }`}
    >
      {icon} <span>{label}</span>
    </button>
  );
}