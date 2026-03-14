import React, { useState } from 'react';

interface ThinkingAccordionProps {
  thoughts?: string;
  isProcessing?: boolean;
}

export const ThinkingAccordion: React.FC<ThinkingAccordionProps> = ({ thoughts, isProcessing }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!thoughts && !isProcessing) return null;

  return (
    <div className="w-full mb-4 border border-teal-200 rounded-lg bg-teal-50/50 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2 flex items-center justify-between text-xs font-medium text-teal-800 bg-teal-100/50 hover:bg-teal-100 transition-colors"
      >
        <span className="flex items-center gap-2">
          {isProcessing ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
              </span>
              Thinking...
            </>
          ) : (
             "Thinking Process"
          )}
        </span>
        <svg
          className={`w-4 h-4 transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {(isOpen || (isProcessing && isOpen)) && (
        <div className="p-4 text-sm text-slate-600 font-mono bg-white border-t border-teal-100 animate-in slide-in-from-top-2">
           {isProcessing ? (
             <div className="flex space-x-1">
               <div className="w-2 h-2 bg-teal-400 rounded-full animate-bounce"></div>
               <div className="w-2 h-2 bg-teal-400 rounded-full animate-bounce delay-75"></div>
               <div className="w-2 h-2 bg-teal-400 rounded-full animate-bounce delay-150"></div>
             </div>
           ) : (
             <p>{thoughts || "Deep analysis completed. (Internal reasoning trace not displayed)"}</p>
           )}
        </div>
      )}
    </div>
  );
};
