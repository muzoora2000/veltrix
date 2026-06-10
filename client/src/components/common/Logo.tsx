import React from 'react';

interface LogoProps {
  className?: string;
  imgClassName?: string;
}

export const Logo: React.FC<LogoProps> = ({ 
  className = "w-10 h-10", 
  imgClassName = "object-contain w-full h-full" 
}) => {
  return (
    <div className={`bg-white rounded p-1 shadow-sm flex items-center justify-center overflow-hidden ${className}`}>
      <img src="/logo.png" alt="HydroSense" className={imgClassName} />
    </div>
  );
};
