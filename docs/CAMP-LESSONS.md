# Camp lessons: Days 2, 3 and 4

These line up with the camp schedule. Times match the curriculum. Each activity names the starter project to load (✨ Starters).

## Day 2: learning code (1/16/27)

**Connecting robots and running a first program (15 min)**
Students connect, then run the preinstalled LED demo (or load **Flashing LEDs** and press Run). The point is that pressing Run makes the robot do what the blocks say.

**Sequencing (20 min)**
Load **Flashing LEDs**. Ask: "What happens if we swap these two blocks?" Try it. Then open 🐍 Python and point out that every block became one line, in the same order. Code is a list of instructions the robot follows top to bottom.

**LED colour challenge (15 min)**
Starting from **Traffic Light**, each student makes their own pattern:
- *Warm-up:* change the three colours.
- *Challenge:* use `set LED (n) to colour` to make a pattern that moves along the stick.
- *Stretch:* use `repeat` so the pattern plays 5 times, then the LEDs turn off.

**Logic expressions: `=`, `<`, `>` (15 min)**
Load **Robot Mood Lights**. Turn the dial and watch the colour change. Read the `if dial < 33` block aloud as a question with a yes or no answer.

**Simon Says (20 min) → if/else (10 min)**
Play Simon Says as a group. Then load **Simon Says Robot**: "Simon" picks a random number, and `if command = 1 … else if command = 2 … else` decides the move. The robot is playing Simon Says too.
- *Challenge:* add a fourth command with its own colour and move.

## Day 3: code plus hardware (1/23/27)

**Forever loops (in the recap)**
`forever` is a loop that never ends until you press Stop. Show it with **Traffic Light**.

**Make the robot go forward (20 min) → race (10 min)**
Load **Move Forward and Stop**. Students change the speed and time to hit a tape line on the floor. Race: who can stop closest to the line?
- Wheels off the table for the first run. Then floor.

**Sensors in code (20 min): gesture-controlled robot**
Load **Gesture-Controlled Robot**. Swipe left/right to turn, up to go forward, down to stop.
- *Challenge:* a different LED colour for each swipe.
- If swipes come out backwards, an instructor changes *Sensor rotation* in settings.

**Ultrasonic distance sensor (20 min)**
Load **Obstacle Detection**. The robot drives until something is closer than 15 cm, then stops and turns red. Try it in the Simulator too: click the floor to drop boxes in its way.
- *Challenge:* instead of stopping, back up and turn away.

**IMU tilt (20 min): pair each axis with a colour channel**
Load **Tilt Color Mixer**. Tipping left/right adds red, tipping forward/back adds blue.
- *Question:* which way do you tilt to make purple?
- Also try **IMU Tilt Alarm** (robot security, a callback to Day 1).

## Day 4: application (1/30/27)

**Maze with IMU turning (30 min)**
Load **Smart Maze Starter**. It drives until a wall, turns right 90° using the IMU, and turns around if that way is blocked too. Practise first in the Simulator → Maze.
- *Challenge:* check left before turning around.
- Remind them the IMU measures how far it has *turned*, not which way it's facing, so small errors add up over a long maze.

**Make your own activity (45 min) → showcase (25 min)**
Any starter can be a jumping-off point. Good prompts:
- A robot pet that reacts to shakes, swipes and being picked up.
- A dance with at least two functions.
- An alarm system that uses two different sensors.

Have every team **💾 Save** before the showcase.
