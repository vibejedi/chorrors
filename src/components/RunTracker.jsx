import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import useAccount, { noteCamera, runPosition } from '../services/accountService';

// Samples the player's position once a second for server-verified runs. The server uses the trail to check
// movement speed and that each room was cleaned from inside it.
export default function RunTracker() {
	const last = useRef(0);
	const running = useAccount((s) => s.run?.status === 'running');

	useFrame(({ camera, clock }) => {
		noteCamera(camera.position.x, camera.position.z);
		if (!running) return;
		const t = clock.elapsedTime;
		if (t - last.current < 1) return;
		last.current = t;
		runPosition(camera.position.x, camera.position.z);
	});

	return null;
}
