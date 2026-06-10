-- CreateIndex
CREATE INDEX "Content_authorId_createdAt_idx" ON "Content"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Content_status_visibility_heatScore_idx" ON "Content"("status", "visibility", "heatScore");

-- CreateIndex
CREATE INDEX "Content_status_visibility_publishedAt_idx" ON "Content"("status", "visibility", "publishedAt");

-- CreateIndex
CREATE INDEX "Content_heatScore_qualityScore_publishedAt_idx" ON "Content"("heatScore", "qualityScore", "publishedAt");

-- CreateIndex
CREATE INDEX "Content_status_visibility_authorId_idx" ON "Content"("status", "visibility", "authorId");

-- CreateIndex
CREATE INDEX "UserActionEvent_contentId_createdAt_idx" ON "UserActionEvent"("contentId", "createdAt");

-- CreateIndex
CREATE INDEX "UserActionEvent_userId_createdAt_idx" ON "UserActionEvent"("userId", "createdAt");
