-- MySQL dump 10.13  Distrib 8.0.41, for Win64 (x86_64)
--
-- Host: localhost    Database: paretops_dev
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
-- Dumping data for table `frozen_measure_data`
--

LOCK TABLES `frozen_measure_data` WRITE;
/*!40000 ALTER TABLE `frozen_measure_data` DISABLE KEYS */;
/*!40000 ALTER TABLE `frozen_measure_data` ENABLE KEYS */;
UNLOCK TABLES;

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
) ENGINE=InnoDB AUTO_INCREMENT=1720 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `help_requests`
--

LOCK TABLES `help_requests` WRITE;
/*!40000 ALTER TABLE `help_requests` DISABLE KEYS */;
INSERT INTO `help_requests` VALUES (1718,'PC1','1','2025-10-08','2025-10-08 17:41:13','2025-10-08 17:41:20'),(1719,'PC1','1','2025-10-08','2025-10-08 17:43:00','2025-10-08 17:43:03');
/*!40000 ALTER TABLE `help_requests` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `improve_full`
--

LOCK TABLES `improve_full` WRITE;
/*!40000 ALTER TABLE `improve_full` DISABLE KEYS */;
/*!40000 ALTER TABLE `improve_full` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `kpi_preferences`
--

LOCK TABLES `kpi_preferences` WRITE;
/*!40000 ALTER TABLE `kpi_preferences` DISABLE KEYS */;
INSERT INTO `kpi_preferences` VALUES (1,'{\"Production Achievement (%)\": 80}','{\"Production Achievement (%)\": \"maximize\"}','[\"Production Achievement (%)\"]','2025-09-23 15:38:45');
/*!40000 ALTER TABLE `kpi_preferences` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `kpi_preferences_maintenance`
--

LOCK TABLES `kpi_preferences_maintenance` WRITE;
/*!40000 ALTER TABLE `kpi_preferences_maintenance` DISABLE KEYS */;
INSERT INTO `kpi_preferences_maintenance` VALUES (1,'{\"MTBF (h)\": 250, \"Mean Downtime (h)\": 22, \"Planned Downtime (h)\": 3, \"Unplanned Downtime (h)\": 10, \"Maintenance Operation Efficiency (%)\": 93, \"Frequency of Machine Interventions (interventions/week)\": 5}','{\"MTBF (h)\": \"maximize\", \"Mean Downtime (h)\": \"minimize\", \"Planned Downtime (h)\": \"maximize\", \"Unplanned Downtime (h)\": \"minimize\", \"Maintenance Operation Efficiency (%)\": \"maximize\", \"Frequency of Machine Interventions (interventions/week)\": \"minimize\"}','2025-11-12 15:42:59');
/*!40000 ALTER TABLE `kpi_preferences_maintenance` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `kpi_yield_data`
--

LOCK TABLES `kpi_yield_data` WRITE;
/*!40000 ALTER TABLE `kpi_yield_data` DISABLE KEYS */;
/*!40000 ALTER TABLE `kpi_yield_data` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `machine_status`
--

LOCK TABLES `machine_status` WRITE;
/*!40000 ALTER TABLE `machine_status` DISABLE KEYS */;
INSERT INTO `machine_status` VALUES ('PC1','UP','2025-09-23 16:00:19'),('PC2','UP','2025-11-12 15:36:38'),('PC4','UP','2025-09-23 15:17:59'),('PC5','DOWN','2025-10-11 00:11:02'),('PC6','UP','2025-09-23 15:17:59'),('PC7','DOWN','2025-09-23 15:34:55'),('PC8','UP','2025-09-23 15:17:59'),('PC9','UP','2025-09-23 15:31:35');
/*!40000 ALTER TABLE `machine_status` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `machining_times`
--

LOCK TABLES `machining_times` WRITE;
/*!40000 ALTER TABLE `machining_times` DISABLE KEYS */;
/*!40000 ALTER TABLE `machining_times` ENABLE KEYS */;
UNLOCK TABLES;

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
) ENGINE=InnoDB AUTO_INCREMENT=708 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `maintenance_logs`
--

LOCK TABLES `maintenance_logs` WRITE;
/*!40000 ALTER TABLE `maintenance_logs` DISABLE KEYS */;
INSERT INTO `maintenance_logs` (`id`, `plyCutter`, `start_time`, `end_time`, `reason`, `work_order`, `comment`, `created_at`) VALUES (629,'PC2','2025-09-23 21:55:48','2025-09-23 22:15:06','Not Specified',NULL,NULL,'2025-09-23 14:55:48'),(630,'PC2','2025-09-23 22:15:29','2025-09-23 22:18:07','Mechanical','WO000056459','This is a comment pretty long','2025-09-23 15:15:29'),(632,'PC7','2025-09-23 22:20:16','2025-09-23 22:33:42','ENG Testing',NULL,NULL,'2025-09-23 15:20:16'),(633,'PC9','2025-09-23 22:20:28','2025-09-23 22:20:34','Fault','WO000056457','This is a comment','2025-09-23 15:20:28'),(634,'PC9','2025-09-23 22:20:59','2025-09-23 22:31:35','Electrical','WO000056459','This is a comment for the electrical issue','2025-09-23 15:20:59'),(635,'PC7','2025-09-23 22:34:55',NULL,'Mechanical','WO000056459','The belt is broken','2025-09-23 15:34:55'),(636,'PC1','2025-09-23 22:41:27','2025-09-23 22:51:11','Electrical',NULL,NULL,'2025-09-23 15:41:27'),(637,'PC1','2025-09-23 22:51:22','2025-09-23 22:57:22','Not Specified',NULL,NULL,'2025-09-23 15:51:22'),(638,'PC1','2025-09-23 22:57:27','2025-09-23 22:59:55','Mechanical',NULL,NULL,'2025-09-23 15:57:27'),(639,'PC1','2025-09-23 22:59:58','2025-09-23 23:00:19','Fault','WO000056459','This is a comment pretty long 2','2025-09-23 15:59:58'),(640,'PC1','2025-09-02 15:00:00','2025-09-02 22:00:00','Mechanical','W000010001','Routine check completed.','2025-10-01 15:23:21'),(641,'PC2','2025-09-03 17:15:00','2025-09-04 15:15:00','Electrical','W000010002','Replaced wiring.','2025-10-01 15:23:21'),(642,'PC4','2025-09-04 21:20:00','2025-09-05 01:50:00','ENG Testing',NULL,'Trial on new parameters.','2025-10-01 15:23:21'),(643,'PC5','2025-09-05 14:45:00','2025-09-06 08:45:00','Fault','W000010003','Unexpected stop - blade issue.','2025-10-01 15:23:21'),(644,'PC6','2025-09-06 16:00:00','2025-09-07 19:00:00','Mechanical',NULL,'Bearing lubrication.','2025-10-01 15:23:21'),(645,'PC7','2025-09-07 18:10:00','2025-09-07 22:40:00','Electrical','W000010004','Replaced fuse.','2025-10-01 15:23:21'),(646,'PC8','2025-09-08 13:00:00','2025-09-10 01:00:00','Not Specified',NULL,'Long downtime investigation.','2025-10-01 15:23:21'),(647,'PC9','2025-09-09 21:00:00','2025-09-09 23:30:00','Mechanical','W000010005','Quick adjustment.','2025-10-01 15:23:21'),(648,'PC1','2025-09-10 16:20:00','2025-09-12 16:20:00','Fault','W000010006','Critical breakdown.','2025-10-01 15:23:21'),(649,'PC2','2025-09-12 15:00:00','2025-09-12 18:00:00','ENG Testing',NULL,'Calibration test.','2025-10-01 15:23:21'),(650,'PC4','2025-09-13 14:15:00','2025-09-13 20:15:00','Mechanical','W000010007','Roller replacement.','2025-10-01 15:23:21'),(651,'PC5','2025-09-14 17:30:00','2025-09-15 17:30:00','Electrical','W000010008','Power board issue.','2025-10-01 15:23:21'),(652,'PC6','2025-09-15 15:45:00','2025-09-15 21:15:00','Not Specified',NULL,'Reported abnormal noise.','2025-10-01 15:23:21'),(653,'PC7','2025-09-16 14:00:00','2025-09-17 08:00:00','Fault','W000010009','Tape misalignment.','2025-10-01 15:23:21'),(654,'PC8','2025-09-17 22:00:00','2025-09-18 22:00:00','Mechanical','W000010010','Routine maintenance.','2025-10-01 15:23:21'),(655,'PC9','2025-09-18 15:20:00','2025-09-19 15:20:00','Electrical',NULL,'Control board replaced.','2025-10-01 15:23:21'),(656,'PC1','2025-09-19 13:45:00','2025-09-19 16:15:00','ENG Testing','W000010011','Sensor recalibration.','2025-10-01 15:23:21'),(657,'PC2','2025-09-20 14:30:00','2025-09-22 14:30:00','Fault','W000010012','Major downtime.','2025-10-01 15:23:21'),(658,'PC4','2025-09-21 15:10:00','2025-09-22 09:10:00','Mechanical',NULL,'Alignment correction.','2025-10-01 15:23:21'),(659,'PC5','2025-09-22 16:40:00','2025-09-23 16:40:00','Not Specified','W000010013','General inspection.','2025-10-01 15:23:21'),(660,'PC6','2025-09-23 14:00:00','2025-09-25 02:00:00','Electrical','W000010014','Circuit replacement.','2025-10-01 15:23:21'),(661,'PC7','2025-09-24 19:00:00','2025-09-25 01:00:00','Mechanical',NULL,'Quick fix.','2025-10-01 15:23:21'),(662,'PC8','2025-09-25 15:30:00','2025-09-25 17:30:00','ENG Testing',NULL,'Test cycle.','2025-10-01 15:23:21'),(663,'PC9','2025-09-26 17:00:00','2025-09-28 17:00:00','Fault','W000010015','Prolonged stoppage.','2025-10-01 15:23:21'),(664,'PC1','2025-09-28 21:00:00','2025-09-29 15:00:00','Mechanical',NULL,'Hydraulic pressure loss.','2025-10-01 15:23:21'),(665,'PC2','2025-09-05 15:00:00','2025-09-16 01:00:00','Mechanical','W000010250','Massive downtime event for testing purposes.','2025-10-01 15:24:15'),(666,'PC2','2025-09-18 14:00:00','2025-09-19 15:00:00','Electrical','W000010251','Extended electrical issue','2025-10-01 15:25:00'),(667,'PC2','2025-09-20 16:30:00','2025-09-21 17:30:00','ENG Testing','W000010252','Long validation test cycle','2025-10-01 15:25:00'),(668,'PC2','2025-09-23 13:15:00','2025-09-24 14:15:00','Fault','W000010253','Major unexpected breakdown','2025-10-01 15:25:00'),(669,'PC5','2025-08-12 15:00:00','2025-08-15 13:00:00','Mechanical','W000010254','Extended mechanical intervention on PC5','2025-10-01 15:25:54'),(670,'PC5','2025-08-03 15:00:00','2025-08-04 03:00:00','Mechanical','W000010301','Routine check, minor intervention','2025-10-01 15:26:36'),(671,'PC5','2025-08-07 16:00:00','2025-08-08 10:00:00','Electrical','W000010302','Power board instability','2025-10-01 15:26:36'),(672,'PC5','2025-08-11 21:00:00','2025-08-12 19:00:00','Fault','W000010303','Unexpected stoppage due to sensor','2025-10-01 15:26:36'),(673,'PC5','2025-08-17 14:30:00','2025-08-18 05:30:00','ENG Testing','W000010304','Validation of new parameters','2025-10-01 15:26:36'),(674,'PC5','2025-08-22 17:00:00','2025-08-23 18:00:00','Not Specified','W000010305','Extended investigation on issue','2025-10-01 15:26:36'),(675,'PC5','2025-10-11 07:11:02',NULL,'Fault','WO000056457','This is a comment','2025-10-11 00:11:02'),(676,'PC1','2025-10-30 14:20:00','2025-10-31 07:10:00','Mechanical','W000010401','Hydraulic seal replacement','2025-11-12 15:37:29'),(677,'PC1','2025-10-12 15:00:00','2025-10-13 22:45:00','Electrical','W000010402','Power relay replacement','2025-11-12 15:37:29'),(678,'PC1','2025-09-29 16:30:00','2025-09-30 09:00:00','Fault','W000010403','Unexpected motor stall','2025-11-12 15:37:29'),(679,'PC2','2025-10-26 13:45:00','2025-10-28 03:15:00','Mechanical','W000010404','Bearing replacement and alignment','2025-11-12 15:37:29'),(680,'PC2','2025-10-04 17:00:00','2025-10-05 09:45:00','ENG Testing','W000010405','Validation cycle for test parameters','2025-11-12 15:37:29'),(681,'PC2','2025-09-24 18:30:00','2025-09-25 16:30:00','Electrical','W000010406','Wiring inspection after overload','2025-11-12 15:37:29'),(682,'PC4','2025-10-27 14:00:00','2025-10-28 13:00:00','Fault','W000010407','Unexpected shutdown during operation','2025-11-12 15:37:29'),(683,'PC4','2025-10-10 19:30:00','2025-10-11 21:15:00','Mechanical','W000010408','Roller track misalignment fix','2025-11-12 15:37:29'),(684,'PC4','2025-09-21 20:00:00','2025-09-22 14:30:00','Electrical','W000010409','Sensor cable repair','2025-11-12 15:37:29'),(685,'PC5','2025-10-25 12:00:00','2025-10-26 05:00:00','ENG Testing','W000010410','Parameter validation for speed upgrade','2025-11-12 15:37:29'),(686,'PC5','2025-10-08 15:45:00','2025-10-10 07:00:00','Mechanical','W000010411','Extended belt replacement','2025-11-12 15:37:29'),(687,'PC5','2025-09-26 14:30:00','2025-09-27 20:00:00','Electrical','W000010412','PLC communication fault','2025-11-12 15:37:29'),(688,'PC6','2025-10-29 16:00:00','2025-10-31 01:00:00','Fault','W000010413','Unexpected pressure loss','2025-11-12 15:37:29'),(689,'PC6','2025-10-16 13:30:00','2025-10-18 00:30:00','Mechanical','W000010414','Linear guide maintenance','2025-11-12 15:37:29'),(690,'PC6','2025-09-23 15:00:00','2025-09-24 16:00:00','Electrical','W000010415','Servo drive instability','2025-11-12 15:37:29'),(691,'PC7','2025-10-28 14:30:00','2025-10-30 06:45:00','ENG Testing','W000010416','Validation of new software build','2025-11-12 15:37:29'),(692,'PC7','2025-10-13 14:15:00','2025-10-14 15:30:00','Mechanical','W000010417','Drive chain lubrication and check','2025-11-12 15:37:29'),(693,'PC7','2025-09-25 16:30:00','2025-09-26 17:00:00','Electrical','W000010418','Panel short-circuit inspection','2025-11-12 15:37:29'),(694,'PC8','2025-10-23 13:00:00','2025-10-24 22:30:00','Fault','W000010419','Unexpected breakdown on vacuum pump','2025-11-12 15:37:29'),(695,'PC8','2025-10-05 14:45:00','2025-10-06 13:15:00','Mechanical','W000010420','Alignment of cutting head','2025-11-12 15:37:29'),(696,'PC8','2025-09-28 15:15:00','2025-09-30 03:30:00','Electrical','W000010421','Replacement of temperature sensor','2025-11-12 15:37:29'),(697,'PC9','2025-10-31 13:45:00','2025-11-01 17:30:00','Mechanical','W000010422','Preventive replacement of motor coupling','2025-11-12 15:37:29'),(698,'PC9','2025-10-19 14:20:00','2025-10-20 10:50:00','ENG Testing','W000010423','Calibration of laser guidance system','2025-11-12 15:37:29'),(699,'PC9','2025-09-27 13:30:00','2025-09-29 06:15:00','Fault','W000010424','Unexpected stoppage due to hydraulic issue','2025-11-12 15:37:29'),(700,'PC1','2025-10-05 16:00:00','2025-10-06 12:00:00','Mechanical','W000010425','Roller maintenance and bearing check','2025-11-12 15:37:29'),(701,'PC2','2025-10-14 17:15:00','2025-10-16 01:45:00','Electrical','W000010426','Power supply unit replacement','2025-11-12 15:37:29'),(702,'PC4','2025-10-09 15:00:00','2025-10-10 05:15:00','Fault','W000010427','Unexpected sensor reading drop','2025-11-12 15:37:29'),(703,'PC5','2025-10-02 14:45:00','2025-10-03 19:45:00','ENG Testing','W000010428','Validation of new tooling set','2025-11-12 15:37:29'),(704,'PC6','2025-10-21 13:45:00','2025-10-22 22:30:00','Mechanical','W000010429','Alignment after vibration issue','2025-11-12 15:37:29'),(705,'PC7','2025-10-17 16:30:00','2025-10-18 13:00:00','Electrical','W000010430','Sensor feedback signal loss','2025-11-12 15:37:29'),(706,'PC8','2025-09-30 14:00:00','2025-10-01 03:00:00','Fault','W000010431','Unexpected air pressure drop','2025-11-12 15:37:29'),(707,'PC9','2025-10-11 13:30:00','2025-10-12 11:00:00','Mechanical','W000010432','Pulley adjustment after vibration','2025-11-12 15:37:29');
/*!40000 ALTER TABLE `maintenance_logs` ENABLE KEYS */;
UNLOCK TABLES;

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
) ENGINE=InnoDB AUTO_INCREMENT=2650 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ply_cutter_obj`
--

LOCK TABLES `ply_cutter_obj` WRITE;
/*!40000 ALTER TABLE `ply_cutter_obj` DISABLE KEYS */;
INSERT INTO `ply_cutter_obj` VALUES (2626,'PC1','2025-09-23',1,12,'2025-10-08 10:41:20','2B',0,3,0,0,0,0),(2627,'PC4','2025-09-23',1,12,'2025-09-23 14:50:15','1B',0,0,0,0,0,0),(2628,'PC4','2025-10-01',1,12,'2025-10-01 15:07:32','2B',0,10,0,0,0,0),(2629,'PC5','2025-10-01',1,10,'2025-10-01 15:07:52','115B',0,8,0,0,0,0),(2630,'PC1','2025-10-01',1,8,'2025-10-08 10:41:20','1B',0,0,0,0,1,0),(2631,'PC6','2025-10-01',1,8,'2025-10-01 15:08:05','9X',0,8,0,0,0,0),(2632,'PC8','2025-10-01',1,12,'2025-10-01 15:08:37','1B',0,8,0,0,0,0),(2633,'PC9','2025-10-01',1,10,'2025-10-01 15:09:01','115B',0,8,0,0,0,0),(2634,'PC1','2025-10-08',1,60,'2025-10-09 07:27:50','OGV',0,11,0,0,0,0),(2635,'PC9','2025-10-08',1,12,'2025-10-09 07:42:10','2B',1,1,0,0,0,0),(2636,'PC1','2025-10-09',1,60,'2025-10-09 07:11:17','OGV',0,1,0,0,0,0),(2637,'PC4','2025-10-09',1,12,'2025-10-09 00:12:11','2B',0,0,0,0,0,0),(2638,'PC5','2025-10-09',1,8,'2025-10-09 00:28:56','9X',0,0,0,0,0,0),(2639,'PC5','2025-10-08',1,0,'2025-10-09 07:29:14','N/A',0,2,0,0,0,0),(2640,'PC6','2025-10-09',1,60,'2025-10-09 00:31:18','Fabric',0,0,0,0,0,0),(2642,'PC6','2025-10-08',1,0,'2025-10-09 07:31:43','N/A',0,1,0,0,0,0),(2643,'PC8','2025-10-08',1,60,'2025-10-09 07:36:08','Fabric',1,0,0,0,0,0),(2644,'PC1','2025-10-10',1,12,'2025-10-11 07:01:14','1B',1,4,0,0,0,0),(2645,'PC9','2025-10-10',1,8,'2025-10-11 07:00:49','9X',1,2,0,0,0,0),(2646,'PC5','2025-10-10',2,10,'2025-10-11 07:10:37','115B',1,1,0,0,0,0),(2647,'PC4','2025-10-11',2,12,'2025-10-11 19:54:46','2B',1,1,0,0,0,0),(2648,'PC1','2025-10-12',1,12,'2025-10-13 00:42:32','1B',1,5,0,0,0,0),(2649,'PC4','2025-10-12',1,60,'2025-10-13 00:43:19','OGV',1,1,0,0,0,0);
/*!40000 ALTER TABLE `ply_cutter_obj` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `project_analyze_data`
--

LOCK TABLES `project_analyze_data` WRITE;
/*!40000 ALTER TABLE `project_analyze_data` DISABLE KEYS */;
/*!40000 ALTER TABLE `project_analyze_data` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `project_close_data`
--

LOCK TABLES `project_close_data` WRITE;
/*!40000 ALTER TABLE `project_close_data` DISABLE KEYS */;
/*!40000 ALTER TABLE `project_close_data` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `project_control_data`
--

LOCK TABLES `project_control_data` WRITE;
/*!40000 ALTER TABLE `project_control_data` DISABLE KEYS */;
/*!40000 ALTER TABLE `project_control_data` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `project_define_data`
--

LOCK TABLES `project_define_data` WRITE;
/*!40000 ALTER TABLE `project_define_data` DISABLE KEYS */;
/*!40000 ALTER TABLE `project_define_data` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `project_improve_data`
--

LOCK TABLES `project_improve_data` WRITE;
/*!40000 ALTER TABLE `project_improve_data` DISABLE KEYS */;
/*!40000 ALTER TABLE `project_improve_data` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `project_machines`
--

LOCK TABLES `project_machines` WRITE;
/*!40000 ALTER TABLE `project_machines` DISABLE KEYS */;
/*!40000 ALTER TABLE `project_machines` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `project_measure_data`
--

LOCK TABLES `project_measure_data` WRITE;
/*!40000 ALTER TABLE `project_measure_data` DISABLE KEYS */;
/*!40000 ALTER TABLE `project_measure_data` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `projects`
--

LOCK TABLES `projects` WRITE;
/*!40000 ALTER TABLE `projects` DISABLE KEYS */;
/*!40000 ALTER TABLE `projects` ENABLE KEYS */;
UNLOCK TABLES;

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
) ENGINE=InnoDB AUTO_INCREMENT=353 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `reported_issues`
--

LOCK TABLES `reported_issues` WRITE;
/*!40000 ALTER TABLE `reported_issues` DISABLE KEYS */;
INSERT INTO `reported_issues` VALUES (331,'2025-10-01 00:00:00','PC8','Machine - Alignment','We had to realign the material on the table 3 times',30,1),(332,'2025-10-01 00:00:00','PC8','Team - Roll change taking too long','Lack of coordination, we need a floater to help us',25,1),(333,'2025-10-01 00:00:00','PC8','Machine - Turned off by itself','we had to restart the machine twice',7,1),(334,'2025-10-01 00:00:00','PC4','Machine - Alignment','Alignment issues',25,1),(335,'2025-10-01 00:00:00','PC4','Team - MAINT action','',10,1),(336,'2025-10-01 00:00:00','PC1','Team - ENG action','',0,1),(337,'2025-10-01 00:00:00','PC1','Machine - Alignment','',20,1),(338,'2025-10-01 00:00:00','PC1','Team - Roll change taking too long','',15,1),(339,'2025-10-01 00:00:00','PC9','Machine - Alignment','The material is off the laser',40,1),(340,'2025-10-10 00:00:00','PC1','Program - Missing Program','',10,1),(341,'2025-10-10 00:00:00','PC1','Program - Network issue','',5,1),(342,'2025-10-10 00:00:00','PC1','Material - Reworks because of tag','',2,1),(343,'2025-10-10 00:00:00','PC1','Material - Reworks because of tag','',0,1),(344,'2025-10-10 00:00:00','PC1','Program - Other','',0,1),(345,'2025-10-10 20:30:01','PC1','Material - Tag','',0,1),(346,'2025-10-11 00:05:24','PC1','Team - MAINT action','',2,1),(347,'2025-10-11 12:54:54','PC4','Machine - Horn','44',4,2),(348,'2025-10-11 13:13:26','PC4','Team - Other','test',5,2),(349,'2025-10-12 06:45:10','PC1','Program - Missing Program','',0,1),(350,'2025-10-12 06:45:21','PC1','Machine - US deviations','2',2,1),(351,'2025-10-12 17:42:41','PC1','Material - Material not ready','',0,1),(352,'2025-10-12 17:43:23','PC4','Material - Reworks because of tag','',0,1);
/*!40000 ALTER TABLE `reported_issues` ENABLE KEYS */;
UNLOCK TABLES;

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

--
-- Dumping data for table `shift_tracking`
--

LOCK TABLES `shift_tracking` WRITE;
/*!40000 ALTER TABLE `shift_tracking` DISABLE KEYS */;
INSERT INTO `shift_tracking` VALUES (1,'GLOBAL',1,'2025-10-10');
/*!40000 ALTER TABLE `shift_tracking` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-11-27  2:57:59
