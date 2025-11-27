-- MySQL dump 10.13  Distrib 8.0.41, for Win64 (x86_64)
--
-- Host: localhost    Database: lean_project_dev
-- ------------------------------------------------------
-- Server version	8.0.41

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `frozen_measure_data`
--

DROP TABLE IF EXISTS `frozen_measure_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `frozen_measure_data` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `kpi` varchar(100) NOT NULL,
  `value_date` date NOT NULL,
  `machine` varchar(20) NOT NULL,
  `value` float DEFAULT NULL,
  `range_days` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_snapshot` (`project_id`,`kpi`,`machine`,`value_date`),
  UNIQUE KEY `unique_entry` (`project_id`,`kpi`,`value_date`,`machine`),
  KEY `idx_project_kpi_date` (`project_id`,`kpi`,`value_date`),
  KEY `idx_machine` (`machine`)
) ENGINE=InnoDB AUTO_INCREMENT=733 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `help_requests`
--

DROP TABLE IF EXISTS `help_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `help_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `plyCutter` varchar(50) NOT NULL,
  `shift` varchar(10) NOT NULL,
  `request_date` date DEFAULT NULL,
  `start_call` timestamp NULL DEFAULT NULL,
  `end_call` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1718 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `improve_full`
--

DROP TABLE IF EXISTS `improve_full`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `improve_full` (
  `project_id` int NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `description` text,
  `effective_date` date DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `estimated_impact` varchar(255) DEFAULT NULL,
  `target_kpi` varchar(255) DEFAULT NULL,
  `table_html` text,
  `stats_html` text,
  `comparison_html` text,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `img_histogram_path` varchar(255) DEFAULT NULL,
  `img_trend_path` varchar(255) DEFAULT NULL,
  `img_compare_hist_path` varchar(255) DEFAULT NULL,
  `img_compare_trend_path` varchar(255) DEFAULT NULL,
  `img_pareto_maint_path` varchar(255) DEFAULT NULL,
  `img_pareto_prod_path` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kpi_preferences`
--

DROP TABLE IF EXISTS `kpi_preferences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_preferences` (
  `id` int NOT NULL DEFAULT '1',
  `thresholds` json DEFAULT NULL,
  `goals` json DEFAULT NULL,
  `highlights` json DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kpi_preferences_maintenance`
--

DROP TABLE IF EXISTS `kpi_preferences_maintenance`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_preferences_maintenance` (
  `id` int NOT NULL,
  `thresholds` json DEFAULT NULL,
  `goals` json DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kpi_yield_data`
--

DROP TABLE IF EXISTS `kpi_yield_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_yield_data` (
  `month` varchar(7) NOT NULL,
  `defects` int DEFAULT '0',
  PRIMARY KEY (`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `machine_status`
--

DROP TABLE IF EXISTS `machine_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `machine_status` (
  `plyCutter` varchar(50) NOT NULL,
  `status` varchar(50) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`plyCutter`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `machining_times`
--

DROP TABLE IF EXISTS `machining_times`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `machining_times` (
  `id` int NOT NULL AUTO_INCREMENT,
  `program` varchar(20) DEFAULT NULL,
  `mt_hours` float DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `program` (`program`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `maintenance_logs`
--

DROP TABLE IF EXISTS `maintenance_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `maintenance_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `plyCutter` varchar(50) NOT NULL,
  `start_time` timestamp NULL DEFAULT NULL,
  `end_time` timestamp NULL DEFAULT NULL,
  `duration` decimal(5,2) GENERATED ALWAYS AS ((timestampdiff(SECOND,`start_time`,`end_time`) / 3600)) STORED,
  `reason` text NOT NULL,
  `work_order` varchar(255) DEFAULT NULL,
  `comment` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=629 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ply_cutter_obj`
--

DROP TABLE IF EXISTS `ply_cutter_obj`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ply_cutter_obj` (
  `id` int NOT NULL AUTO_INCREMENT,
  `plyCutter` varchar(50) DEFAULT NULL,
  `day` date NOT NULL,
  `shift` tinyint NOT NULL,
  `obj_value` int DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `program` varchar(255) DEFAULT NULL,
  `submitted` tinyint(1) DEFAULT '0',
  `prod_value` int DEFAULT '0',
  `down` tinyint DEFAULT '0',
  `floater` tinyint DEFAULT '0',
  `trainee` tinyint DEFAULT '0',
  `help_requested` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_plycutter_day_shift` (`plyCutter`,`day`,`shift`)
) ENGINE=InnoDB AUTO_INCREMENT=2626 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `project_analyze_data`
--

DROP TABLE IF EXISTS `project_analyze_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_analyze_data` (
  `project_id` int NOT NULL,
  `stats_html` text,
  `logs_maintenance` text,
  `logs_production` text,
  `img_trend_path` varchar(255) DEFAULT NULL,
  `img_pareto_maint_path` varchar(255) DEFAULT NULL,
  `img_pareto_prod_path` varchar(255) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `project_close_data`
--

DROP TABLE IF EXISTS `project_close_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_close_data` (
  `project_id` int NOT NULL,
  `actual_closure_date` date DEFAULT NULL,
  `measured_impact` varchar(255) DEFAULT NULL,
  `comment` text,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `outcome` enum('success','failure') DEFAULT NULL,
  PRIMARY KEY (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `project_control_data`
--

DROP TABLE IF EXISTS `project_control_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_control_data` (
  `project_id` int NOT NULL,
  `check_0` tinyint(1) DEFAULT NULL,
  `check_1` tinyint(1) DEFAULT NULL,
  `check_2` tinyint(1) DEFAULT NULL,
  `check_3` tinyint(1) DEFAULT NULL,
  `check_4` tinyint(1) DEFAULT NULL,
  `check_5` tinyint(1) DEFAULT NULL,
  `comment` text,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `project_define_data`
--

DROP TABLE IF EXISTS `project_define_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_define_data` (
  `project_id` bigint unsigned NOT NULL,
  `problem_definition` text,
  `estimated_impact` varchar(255) DEFAULT NULL,
  `last_updated` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`project_id`),
  CONSTRAINT `project_define_data_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `project_improve_data`
--

DROP TABLE IF EXISTS `project_improve_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_improve_data` (
  `project_id` int NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `description` text,
  `effective_date` date DEFAULT NULL,
  `status` enum('Proposed','Testing','Implemented','Abandoned') DEFAULT 'Proposed',
  `estimated_impact` varchar(100) DEFAULT NULL,
  `target_kpi` varchar(100) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `project_machines`
--

DROP TABLE IF EXISTS `project_machines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_machines` (
  `project_id` bigint unsigned NOT NULL,
  `machine_name` varchar(10) NOT NULL,
  PRIMARY KEY (`project_id`,`machine_name`),
  CONSTRAINT `project_machines_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `project_measure_data`
--

DROP TABLE IF EXISTS `project_measure_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_measure_data` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `range_days` int NOT NULL,
  `kpi_name` varchar(100) NOT NULL,
  `machine_name` varchar(20) NOT NULL,
  `mean_value` float DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_entry` (`project_id`,`kpi_name`,`machine_name`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `projects`
--

DROP TABLE IF EXISTS `projects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `projects` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` text NOT NULL,
  `start_date` date NOT NULL,
  `closure_date` date DEFAULT NULL,
  `status` text NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  CONSTRAINT `projects_chk_1` CHECK ((`status` in (_cp850'Define',_cp850'Measure',_cp850'Analyze',_cp850'Improve',_cp850'Control',_cp850'Closed')))
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `reported_issues`
--

DROP TABLE IF EXISTS `reported_issues`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reported_issues` (
  `id` int NOT NULL AUTO_INCREMENT,
  `date` datetime NOT NULL,
  `plyCutter` varchar(50) DEFAULT NULL,
  `issue_type` text NOT NULL,
  `comment` text,
  `downtime` int NOT NULL,
  `shift` int NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=331 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `shift_tracking`
--

DROP TABLE IF EXISTS `shift_tracking`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shift_tracking` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ply_cutter` varchar(10) NOT NULL,
  `shift` int NOT NULL,
  `day` date NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ply_cutter` (`ply_cutter`,`day`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-09-23  7:47:13
