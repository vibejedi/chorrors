import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import useRanked, { noteCamera, rankedPosition } from '../services/rankedService';

// Samples the player's position once a second for ranked runs. The server uses the trail to check
// movement speed and that each room was cleaned from inside it.
export default function RankedTracker() {
	const last = useRef(0);
	const running = useRanked((s) => s.run?.status === 'running');

	useFrame(({ camera, clock }) => {
		noteCamera(camera.position.x, camera.position.z);
		if (!running) return;
		const t = clock.elapsedTime;
		if (t - last.current < 1) return;
		last.current = t;
		rankedPosition(camera.position.x, camera.position.z);
	});

	return null;
}
