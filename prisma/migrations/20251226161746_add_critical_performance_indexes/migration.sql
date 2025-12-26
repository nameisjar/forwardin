-- CreateIndex
CREATE INDEX "idx_course_feedback_course" ON "CourseFeedback"("courseName");

-- CreateIndex
CREATE INDEX "idx_course_feedback_course_lesson" ON "CourseFeedback"("courseName", "lesson");

-- CreateIndex
CREATE INDEX "idx_outgoing_message_status" ON "OutgoingMessage"("status");
