Sys.umask("0077")
suppressPackageStartupMessages(library(tidyverse))
suppressPackageStartupMessages(library(jsonlite))
initial_assignment_pipe <- find("%<>%")
if (!exists("%<>%", mode = "function")) suppressPackageStartupMessages(library(magrittr))

dir.create("/work/preprocessed_data")
dir.create("/work/run")
stopifnot(file.copy("/input/analysis.csv", "/work/preprocessed_data/analysis.csv"))
stopifnot(file.copy("/source/load_data.R", "/work/load_data.R"))
setwd("/work/run")
source_hash <- digest::digest(file = "/work/load_data.R", algo = "sha256")
stopifnot(source_hash == "b2c12ecb356742dd05c23abb9c7ca78013125a87f24bf279c0b38f778e16302c")
input_hash <- digest::digest(file = "../preprocessed_data/analysis.csv", algo = "sha256")
main_pred <- "screentime"
filter_missing_background <- TRUE
filter_multiple_semesters <- FALSE
source_warnings <- character()
tryCatch(withCallingHandlers(sys.source("/work/load_data.R", envir = globalenv()),
  warning = function(w) { source_warnings <<- c(source_warnings, conditionMessage(w)); invokeRestart("muffleWarning") }),
  error = function(e) {
    writeLines(toJSON(list(error = conditionMessage(e), warnings = I(source_warnings),
      sourceSha256 = source_hash, inputSha256 = input_hash), auto_unbox = TRUE), "/output/failure.json", useBytes = TRUE)
    quit(status = 1)
  })

table_result <- function(df) {
  encode <- function(column) {
    if (is.factor(column)) return(as.character(column))
    if (is.numeric(column)) return(vapply(column, function(value) {
      if (is.nan(value)) return("NaN")
      if (is.na(value)) return(NA_character_)
      format(value, digits = 17, trim = TRUE)
    }, character(1)))
    as.character(column)
  }
  values <- lapply(df, encode)
  list(columns = I(names(df)), classes = lapply(df, function(column) I(class(column))),
       levels = lapply(df[vapply(df, is.factor, logical(1))], function(column) I(levels(column))),
       rows = lapply(seq_len(nrow(df)), function(i) unname(lapply(values, `[[`, i))))
}
saveRDS(course_ind_df, "/output/course_ind_df.rds", version = 3)
saveRDS(ind_avr_df, "/output/ind_avr_df.rds", version = 3)
write_csv(course_ind_df, "/output/course_ind_df.csv")
write_csv(ind_avr_df, "/output/ind_avr_df.csv")
parsed_input <- suppressWarnings(suppressMessages(read_csv("../preprocessed_data/analysis.csv")))
writeLines(toJSON(list(
  schemaVersion = "chronicle-bjerre-preparation-tables/v1",
  sourceSha256 = source_hash, inputSha256 = input_hash, inputRows = nrow(parsed_input),
  input = table_result(parsed_input), course = table_result(course_ind_df), participant = table_result(ind_avr_df),
  R = R.version.string, locale = Sys.getlocale(),
  initialAssignmentPipeAttachments = I(initial_assignment_pipe), finalAssignmentPipeAttachments = I(find("%<>%")),
  packages = lapply(c("tidyverse", "dplyr", "readr", "magrittr", "jsonlite", "digest"),
    function(p) list(package = p, version = as.character(packageVersion(p)))),
  warnings = I(source_warnings),
  limitations = I(c("Original analysis.csv and author dependency versions are unavailable.",
    "This is unchanged released preparation under the declared compatible R environment, not the later models or original-cohort reproduction.",
    "The harness attaches magrittr explicitly when the source caller's attachment chain lacks %<>%.",
    "RDS retains source objects; CSV projections alone do not preserve factor types or all missing-value distinctions."))
), auto_unbox = TRUE, digits = 17, na = "null", null = "null"), "/output/tables.json", useBytes = TRUE)
