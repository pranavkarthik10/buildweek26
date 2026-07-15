# Product decisions

## Positioning

studydeck is the missing instructor for class content. Students bring slides, notes, or PDFs, and studydeck explains the gaps, answers questions, and draws annotations and examples as they learn.

The product should not sound like it merely summarizes uploaded files or reads slides aloud. The core wedge is filling in what static course materials leave out: derivations, intuition, examples, diagrams, and professor-style explanation.

## Brand language

Use `studydeck` in all lowercase in product copy, metadata, documentation, and UI labels.

Avoid mentioning model or vendor names in user-facing copy. Describe the student outcome instead.

## Pricing direction

For the MVP, use upload-based limits externally rather than slide-only, session-only, or minute-based limits.

Current intended pricing shape:

- Free: 3 uploads per month, up to 100 pages per upload, core explanations, limited questions and annotations.
- Student: 30 uploads per month, up to 300 pages per upload, expanded explanations, personalized annotations and diagrams, more follow-up questions, saved course library.
- Pro: 100 uploads per month, up to 600 pages per upload, advanced annotations and worked examples, high question allowance, priority processing, exam prep mode.

Internally, usage can still be metered by events or credits such as upload processing, explanation generation, Q&A, annotation generation, diagram generation, and audio generation.

## Dashboard model

For the MVP, the dashboard should revolve around uploaded class content/decks, not sessions as a top-level concept.

Sessions should remain an internal persistence model for progress, history, and resume/restart behavior. In the UI, each deck/content item should expose the important actions directly:

- Start if it has not been used.
- Resume if there is in-progress work.
- Restart/review again if it has been completed or the student wants a fresh pass.

A separate sessions tab can come later if session history becomes valuable enough to manage directly.

## Teaching formats

Before starting or restarting a lesson, students should be able to pick a teaching format:

- Lecture: explains with minimal interruptions.
- Small-class: asks a moderate number of check-in questions.
- 1-1 tutoring: follows up frequently and adapts more aggressively to the student's answers.

Students should also be able to add custom instructions, such as what to focus on, what background knowledge to assume, exam style, pace, or where they tend to get stuck.

Teaching format and custom instructions should be editable during a session, because students often learn what they need only after the lesson starts.
