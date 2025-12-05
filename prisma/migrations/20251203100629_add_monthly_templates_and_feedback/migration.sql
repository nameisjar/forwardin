-- CreateTable
CREATE TABLE "MonthlyTemplate" (
    "pkId" SERIAL NOT NULL,
    "id" UUID NOT NULL,
    "course_name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "month" INTEGER NOT NULL,
    "level" VARCHAR(100) NOT NULL,
    "topic_module" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "skills_acquired" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyTemplate_pkey" PRIMARY KEY ("pkId")
);

-- CreateTable
CREATE TABLE "MonthlyFeedbackLog" (
    "pkId" SERIAL NOT NULL,
    "id" UUID NOT NULL,
    "student_name" VARCHAR(255) NOT NULL,
    "course_name" VARCHAR(255) NOT NULL,
    "month" INTEGER NOT NULL,
    "recipient_phone" VARCHAR(20) NOT NULL,
    "sent_by" UUID NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyFeedbackLog_pkey" PRIMARY KEY ("pkId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyTemplate_id_key" ON "MonthlyTemplate"("id");

-- CreateIndex
CREATE INDEX "MonthlyTemplate_course_name_idx" ON "MonthlyTemplate"("course_name");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyTemplate_course_name_month_key" ON "MonthlyTemplate"("course_name", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyFeedbackLog_id_key" ON "MonthlyFeedbackLog"("id");

-- CreateIndex
CREATE INDEX "MonthlyFeedbackLog_sent_by_idx" ON "MonthlyFeedbackLog"("sent_by");

-- CreateIndex
CREATE INDEX "MonthlyFeedbackLog_course_name_idx" ON "MonthlyFeedbackLog"("course_name");

-- CreateIndex
CREATE INDEX "MonthlyFeedbackLog_sent_at_idx" ON "MonthlyFeedbackLog"("sent_at");
