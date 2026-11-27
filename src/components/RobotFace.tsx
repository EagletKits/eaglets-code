import type { RobotState } from '../robot/connection';

/** A small robot whose face shows the connection state: asleep, awake, or busy. */
export function RobotFace({ state }: { state: RobotState }) {
  const asleep = state === 'disconnected';
  return (
    <svg className={`robot-face robot-face-${state}`} viewBox="0 0 48 48" width="52" height="52" aria-hidden="true">
      <path d="M24 10V5" className="rf-stroke" />
      <circle cx="24" cy="4.5" r="3" className="rf-bulb" />
      <rect x="5" y="10" width="38" height="32" rx="11" className="rf-head" />
      {asleep ? (
        <path d="M12 25q4.5 3.5 9 0M27 25q4.5 3.5 9 0" className="rf-stroke rf-eyes-closed" />
      ) : (
        <>
          <circle cx="17" cy="24" r="4.2" className="rf-eye" />
          <circle cx="31" cy="24" r="4.2" className="rf-eye" />
        </>
      )}
      <path d={asleep ? 'M19 34h10' : 'M17.5 32q6.5 6.5 13 0'} className="rf-stroke" />
    </svg>
  );
}
