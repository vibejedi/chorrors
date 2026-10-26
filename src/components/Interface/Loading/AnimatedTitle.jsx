import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import './AnimatedTitle.css';

const AnimatedTitle = ({ onComplete }) => {
	const titleRef = useRef(null);

	useGSAP(
		() => {
			if (!titleRef.current) return;

			const words = gsap.utils.toArray(
				titleRef.current.querySelectorAll('.title-word')
			);
			const tagline = titleRef.current.querySelector('.title-tagline');

			gsap.set(words, {
				strokeDasharray: 1500,
				strokeDashoffset: 1500,
				fillOpacity: 0,
			});
			gsap.set(tagline, { opacity: 0 });

			const tl = gsap.timeline({
				delay: 0.2,
				onComplete: () => {
					if (onComplete && typeof onComplete === 'function') {
						onComplete();
					}
				},
			});

			// Scrawl the outline, then let the blood seep in
			tl.to(words, {
				strokeDashoffset: 0,
				duration: 3.5,
				stagger: 0.8,
				ease: 'power2.inOut',
			})
				.to(
					words,
					{
						fillOpacity: 1,
						duration: 1.2,
						stagger: 0.3,
						ease: 'power1.in',
					},
					'-=1.2'
				)
				.to(tagline, { opacity: 1, duration: 1, ease: 'power1.out' }, '-=0.6');

			return tl;
		},
		{ scope: titleRef }
	);

	return (
		<svg
			ref={titleRef}
			className="animated-title"
			xmlns="http://www.w3.org/2000/svg"
			width="732"
			height="110"
			viewBox="0 0 732 110"
			fill="none"
		>
			<text
				className="title-word"
				x="6"
				y="72"
				textLength="380"
				lengthAdjust="spacingAndGlyphs"
			>
				CLEANING
			</text>
			<text
				className="title-word"
				x="416"
				y="72"
				textLength="310"
				lengthAdjust="spacingAndGlyphs"
			>
				HORRORS
			</text>
			<text className="title-tagline" x="366" y="104" textAnchor="middle">
				A HORRORS.FUN GAME
			</text>
		</svg>
	);
};

export default AnimatedTitle;
