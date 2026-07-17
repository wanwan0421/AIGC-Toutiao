Create one horizontal animation strip for Codex pet `sulong`, state `waiting`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 6 full-body frames in one left-to-right row on flat pure user-selected #FF00FF. Treat the row as 6 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: 粉色圆润小恐龙“素龙”：亮粉主体，浅粉圆肚，深红色背鳍与眉形斑，单只黑色椭圆眼睛，白色小三角牙，嘴角含一小片绿色叶子；粗深粉描边，小短手和三趾脚。保持参考图的萌系扁平贴纸插画风，简洁、无饰品、无文字。此轮仅修复方向移动动作，所有新图必须使用纯 #FF00FF 洋红色键色，宠物边缘与绿叶附近不得出现任何 #FF00FF 或近似色。. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `sticker`: Polished sticker mascot with bold clean shapes, crisp outline, flat colors, and minimal highlight detail. User style notes: 修复轮：保持上一轮已批准的粉色贴纸素龙身份；方向移动帧使用干净纯 #FF00FF 背景和更宽留白，边缘应硬朗且无背景溢色。.
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Needs-input loop: expectant asking pose for approval, help, or user input.

State requirements:
- Show that Codex needs approval, help, or user input through an expectant asking pose.
- Keep the motion patient and readable, without turning it into ordinary idle or review.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.
