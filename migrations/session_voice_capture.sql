-- Voice booking: what he said, and what could not be resolved from it.
--
-- Rafa is overloaded and the booking dialog's questions are exactly what he
-- routes around, so the microphone has to be the whole interface: he speaks
-- the meeting and it gets created. ALWAYS created -- a meeting that exists
-- with a gap in it is worth more than a question he walked away from.
--
-- voice_flagged marks a row Alice needs to finish. It is NOT set for a
-- meeting that simply has no client: "cha de panela Iasmin" (a bridal shower,
-- where Iasmin is an owner of PRODUWALL) is personal, correctly has no client,
-- and flagging it would train everyone to ignore the banner.
--
-- voice_transcript keeps his own words so the modal can show what was heard
-- rather than only what was parsed -- when the match is wrong, the words are
-- the only way to see why.
ALTER TABLE sessions ADD COLUMN voice_flagged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN voice_transcript TEXT;
ALTER TABLE sessions ADD COLUMN voice_missing TEXT;
